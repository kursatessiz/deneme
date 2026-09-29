import { Injectable } from '@nestjs/common';
import { Prisma, StockMovementType } from '@platform/database';
import type { Product, ProductCategory, StockLevel } from '@platform/database';
import { isLowStock } from '@platform/shared';
import type {
  AdjustStockInput,
  CreateProductCategoryInput,
  CreateProductInput,
  ListProductsQuery,
  LowStockItemDTO,
  ProductCategoryDTO,
  ProductDTO,
  ReceiveStockInput,
  RetailSettingsDTO,
  RetailSettingsInput,
  StockMovementDTO,
  StockMovementsQuery,
  TransferStockInput,
  UpdateProductCategoryInput,
  UpdateProductInput,
} from '@platform/shared';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import type { TenantContext } from '../auth/tenant-context';
import { assertBranchAccess, canAccessBranch } from '../branches/branch-access';
import { retailError } from './retail.errors';
import { applyStockChange, loadTaxContext, lockedStockLevel } from './retail-stock';

type ProductWithRelations = Product & {
  category: ProductCategory | null;
  stockLevels: (StockLevel & { branch: { name: string } })[];
};

/**
 * Retail catalogue and stock (G3c-2, docs/PERAKENDE.md): settings,
 * categories, products, stock receive/adjust/transfer, the stock ledger and
 * the low-stock list. Every query is filtered by the tenant's studio; stock
 * rows are further limited to the caller's branches.
 */
@Injectable()
export class RetailCatalogService {
  constructor(private readonly prisma: PrismaService) {}

  // -- Settings -------------------------------------------------------------

  async getSettings(studioId: string): Promise<RetailSettingsDTO> {
    const [settings, tax] = await Promise.all([this.prisma.retailSettings.findUnique({ where: { studioId } }), loadTaxContext(this.prisma, studioId)]);
    return {
      allowBackorder: settings?.allowBackorder ?? false,
      receiptPrefix: settings?.receiptPrefix ?? 'S',
      currency: tax.currency,
      pricesIncludeTax: tax.pricesIncludeTax,
      taxRegime: tax.taxRegime,
      defaultTaxRate: tax.defaultTaxRate,
    };
  }

  async updateSettings(tenant: TenantContext, actorUserId: string, dto: RetailSettingsInput): Promise<RetailSettingsDTO> {
    const studioId = tenant.studioId;
    await this.prisma.retailSettings.upsert({
      where: { studioId },
      create: { studioId, ...dto },
      update: { ...dto },
    });
    await this.prisma.auditLog.create({
      data: { studioId, userId: actorUserId, action: 'retail.settings.update', entityType: 'RetailSettings', entityId: studioId, metadata: { ...dto } },
    });
    return this.getSettings(studioId);
  }

  // -- Categories -------------------------------------------------------------

  async listCategories(studioId: string): Promise<ProductCategoryDTO[]> {
    const rows = await this.prisma.productCategory.findMany({
      where: { studioId },
      include: { _count: { select: { products: true } } },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return rows.map((c) => ({ id: c.id, name: c.name, sortOrder: c.sortOrder, isActive: c.isActive, productCount: c._count.products }));
  }

  async createCategory(studioId: string, dto: CreateProductCategoryInput): Promise<ProductCategoryDTO> {
    try {
      const c = await this.prisma.productCategory.create({ data: { studioId, ...dto } });
      return { id: c.id, name: c.name, sortOrder: c.sortOrder, isActive: c.isActive, productCount: 0 };
    } catch (err) {
      throw this.mapUnique(err);
    }
  }

  async updateCategory(studioId: string, categoryId: string, dto: UpdateProductCategoryInput): Promise<ProductCategoryDTO> {
    await this.findCategory(studioId, categoryId);
    try {
      await this.prisma.productCategory.update({ where: { id: categoryId }, data: dto });
    } catch (err) {
      throw this.mapUnique(err);
    }
    const [category] = (await this.listCategories(studioId)).filter((c) => c.id === categoryId);
    return category;
  }

  /** Products of a deleted category stay, uncategorised. */
  async deleteCategory(studioId: string, categoryId: string): Promise<void> {
    await this.findCategory(studioId, categoryId);
    await this.prisma.productCategory.delete({ where: { id: categoryId } });
  }

  private async findCategory(studioId: string, categoryId: string): Promise<ProductCategory> {
    const category = await this.prisma.productCategory.findFirst({ where: { id: categoryId, studioId } });
    if (!category) throw retailError('RETAIL_CATEGORY_NOT_FOUND');
    return category;
  }

  // -- Products -------------------------------------------------------------

  async listProducts(tenant: TenantContext, query: ListProductsQuery): Promise<ProductDTO[]> {
    if (query.branchId) assertBranchAccess(tenant, query.branchId);
    const search = query.search?.trim();
    const rows = await this.prisma.product.findMany({
      where: {
        studioId: tenant.studioId,
        ...(query.active === 'all' ? {} : { isActive: query.active === 'true' }),
        ...(query.categoryId ? { categoryId: query.categoryId } : {}),
        ...(query.barcode ? { barcode: query.barcode } : {}),
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: 'insensitive' } },
                { sku: { contains: search, mode: 'insensitive' } },
                { barcode: search },
              ],
            }
          : {}),
      },
      include: this.productInclude(),
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      take: 500,
    });
    const tax = await loadTaxContext(this.prisma, tenant.studioId);
    return rows.map((p) => this.toProductDTO(tenant, p, tax.defaultTaxRate, query.branchId));
  }

  async getProduct(tenant: TenantContext, productId: string): Promise<ProductDTO> {
    const product = await this.prisma.product.findFirst({ where: { id: productId, studioId: tenant.studioId }, include: this.productInclude() });
    if (!product) throw retailError('RETAIL_PRODUCT_NOT_FOUND');
    const tax = await loadTaxContext(this.prisma, tenant.studioId);
    return this.toProductDTO(tenant, product, tax.defaultTaxRate);
  }

  async createProduct(tenant: TenantContext, actorUserId: string, dto: CreateProductInput): Promise<ProductDTO> {
    const studioId = tenant.studioId;
    const tax = await loadTaxContext(this.prisma, studioId);
    if (dto.currency && dto.currency !== tax.currency) throw retailError('RETAIL_CURRENCY_MISMATCH');
    if (dto.categoryId) await this.findCategory(studioId, dto.categoryId);
    let product: Product;
    try {
      product = await this.prisma.product.create({
        data: {
          studioId,
          name: dto.name,
          categoryId: dto.categoryId ?? null,
          sku: dto.sku ?? null,
          barcode: dto.barcode ?? null,
          description: dto.description ?? null,
          price: new Prisma.Decimal(dto.price),
          currency: tax.currency,
          taxRate: dto.taxRate === undefined || dto.taxRate === null ? null : new Prisma.Decimal(dto.taxRate),
          costPrice: dto.costPrice ? new Prisma.Decimal(dto.costPrice) : null,
          isActive: dto.isActive ?? true,
          trackStock: dto.trackStock ?? true,
          lowStockThreshold: dto.lowStockThreshold ?? null,
          imageUrl: dto.imageUrl ?? null,
        },
      });
    } catch (err) {
      throw this.mapUnique(err);
    }
    await this.prisma.auditLog.create({
      data: { studioId, userId: actorUserId, action: 'retail.product.create', entityType: 'Product', entityId: product.id },
    });
    return this.getProduct(tenant, product.id);
  }

  async updateProduct(tenant: TenantContext, actorUserId: string, productId: string, dto: UpdateProductInput): Promise<ProductDTO> {
    const studioId = tenant.studioId;
    const existing = await this.prisma.product.findFirst({ where: { id: productId, studioId } });
    if (!existing) throw retailError('RETAIL_PRODUCT_NOT_FOUND');
    if (dto.currency && dto.currency !== existing.currency) throw retailError('RETAIL_CURRENCY_MISMATCH');
    if (dto.categoryId) await this.findCategory(studioId, dto.categoryId);
    try {
      await this.prisma.product.update({
        where: { id: productId },
        data: {
          name: dto.name,
          categoryId: dto.categoryId,
          sku: dto.sku,
          barcode: dto.barcode,
          description: dto.description,
          price: dto.price !== undefined ? new Prisma.Decimal(dto.price) : undefined,
          taxRate: dto.taxRate === undefined ? undefined : dto.taxRate === null ? null : new Prisma.Decimal(dto.taxRate),
          costPrice: dto.costPrice === undefined ? undefined : dto.costPrice === null ? null : new Prisma.Decimal(dto.costPrice),
          isActive: dto.isActive,
          trackStock: dto.trackStock,
          lowStockThreshold: dto.lowStockThreshold,
          imageUrl: dto.imageUrl,
        },
      });
    } catch (err) {
      throw this.mapUnique(err);
    }
    await this.prisma.auditLog.create({
      data: { studioId, userId: actorUserId, action: 'retail.product.update', entityType: 'Product', entityId: productId, metadata: { fields: Object.keys(dto) } },
    });
    return this.getProduct(tenant, productId);
  }

  /** A product with sales or stock history is deactivated instead, so receipts and the ledger keep their reference. */
  async deleteProduct(tenant: TenantContext, actorUserId: string, productId: string): Promise<{ deleted: boolean; deactivated: boolean }> {
    const studioId = tenant.studioId;
    const product = await this.prisma.product.findFirst({
      where: { id: productId, studioId },
      include: { _count: { select: { saleLines: true, stockMovements: true } } },
    });
    if (!product) throw retailError('RETAIL_PRODUCT_NOT_FOUND');
    const used = product._count.saleLines > 0 || product._count.stockMovements > 0;
    if (used) {
      await this.prisma.product.update({ where: { id: productId }, data: { isActive: false } });
    } else {
      await this.prisma.product.delete({ where: { id: productId } });
    }
    await this.prisma.auditLog.create({
      data: { studioId, userId: actorUserId, action: used ? 'retail.product.deactivate' : 'retail.product.delete', entityType: 'Product', entityId: productId },
    });
    return { deleted: !used, deactivated: used };
  }

  // -- Stock ------------------------------------------------------------------

  async receiveStock(tenant: TenantContext, actorUserId: string, dto: ReceiveStockInput): Promise<ProductDTO> {
    const product = await this.trackedProduct(tenant, dto.productId);
    await this.assertBranch(tenant, dto.branchId);
    await this.prisma.$transaction((tx) =>
      applyStockChange(tx, {
        studioId: tenant.studioId,
        productId: product.id,
        branchId: dto.branchId,
        delta: dto.quantity,
        type: StockMovementType.RECEIVE,
        allowNegative: false,
        reason: dto.reason,
        reference: dto.reference,
        unitCost: dto.unitCost ?? null,
        actorUserId,
      }),
    );
    return this.getProduct(tenant, product.id);
  }

  /** Signed correction or a stock count; the result may never be negative. */
  async adjustStock(tenant: TenantContext, actorUserId: string, dto: AdjustStockInput): Promise<ProductDTO> {
    const product = await this.trackedProduct(tenant, dto.productId);
    await this.assertBranch(tenant, dto.branchId);
    await this.prisma.$transaction(async (tx) => {
      let delta = dto.delta ?? 0;
      if (dto.countedQuantity !== undefined) {
        const current = await lockedStockLevel(tx, tenant.studioId, product.id, dto.branchId);
        delta = dto.countedQuantity - current;
      }
      if (delta === 0) return;
      await applyStockChange(tx, {
        studioId: tenant.studioId,
        productId: product.id,
        branchId: dto.branchId,
        delta,
        type: StockMovementType.ADJUSTMENT,
        allowNegative: false,
        reason: dto.reason,
        actorUserId,
      });
    });
    return this.getProduct(tenant, product.id);
  }

  /** Two ledger rows sharing one reference; the source may never go negative. Locks in branch id order to avoid deadlocks. */
  async transferStock(tenant: TenantContext, actorUserId: string, dto: TransferStockInput): Promise<ProductDTO> {
    if (dto.fromBranchId === dto.toBranchId) throw retailError('RETAIL_SAME_BRANCH');
    const product = await this.trackedProduct(tenant, dto.productId);
    await this.assertBranch(tenant, dto.fromBranchId);
    await this.assertBranch(tenant, dto.toBranchId);
    const reference = `transfer:${randomUUID()}`;
    await this.prisma.$transaction(async (tx) => {
      for (const branchId of [dto.fromBranchId, dto.toBranchId].sort()) {
        await lockedStockLevel(tx, tenant.studioId, product.id, branchId);
      }
      await applyStockChange(tx, {
        studioId: tenant.studioId,
        productId: product.id,
        branchId: dto.fromBranchId,
        delta: -dto.quantity,
        type: StockMovementType.TRANSFER,
        allowNegative: false,
        reason: dto.reason,
        reference,
        actorUserId,
      });
      await applyStockChange(tx, {
        studioId: tenant.studioId,
        productId: product.id,
        branchId: dto.toBranchId,
        delta: dto.quantity,
        type: StockMovementType.TRANSFER,
        allowNegative: false,
        reason: dto.reason,
        reference,
        actorUserId,
      });
    });
    return this.getProduct(tenant, product.id);
  }

  async listMovements(tenant: TenantContext, query: StockMovementsQuery): Promise<{ items: StockMovementDTO[]; total: number; page: number; limit: number }> {
    if (query.branchId) assertBranchAccess(tenant, query.branchId);
    const where: Prisma.StockMovementWhereInput = {
      studioId: tenant.studioId,
      ...(query.productId ? { productId: query.productId } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.branchId ? { branchId: query.branchId } : tenant.branchIds ? { branchId: { in: [...tenant.branchIds] } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.stockMovement.findMany({
        where,
        include: { product: { select: { name: true } }, branch: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.stockMovement.count({ where }),
    ]);
    const names = await this.userNames(rows.map((r) => r.actorUserId));
    return {
      items: rows.map((r) => ({
        id: r.id,
        productId: r.productId,
        productName: r.product.name,
        branchId: r.branchId,
        branchName: r.branch.name,
        type: r.type,
        quantity: r.quantity,
        quantityAfter: r.quantityAfter,
        reason: r.reason,
        reference: r.reference,
        unitCost: r.unitCost ? r.unitCost.toFixed(2) : null,
        saleId: r.saleId,
        actorName: r.actorUserId ? (names.get(r.actorUserId) ?? null) : null,
        createdAt: r.createdAt.toISOString(),
      })),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  /** Active, tracked products with a threshold whose level at a branch is at or below it (branches where the product was ever stocked). */
  async lowStock(tenant: TenantContext, branchId?: string): Promise<LowStockItemDTO[]> {
    if (branchId) assertBranchAccess(tenant, branchId);
    const rows = await this.prisma.stockLevel.findMany({
      where: {
        studioId: tenant.studioId,
        ...(branchId ? { branchId } : tenant.branchIds ? { branchId: { in: [...tenant.branchIds] } } : {}),
        product: { isActive: true, trackStock: true, lowStockThreshold: { not: null } },
      },
      include: { product: { select: { name: true, sku: true, lowStockThreshold: true } }, branch: { select: { name: true } } },
    });
    return rows
      .filter((r) => isLowStock(r.quantity, r.product.lowStockThreshold))
      .map((r) => ({
        productId: r.productId,
        productName: r.product.name,
        sku: r.product.sku,
        branchId: r.branchId,
        branchName: r.branch.name,
        quantity: r.quantity,
        lowStockThreshold: r.product.lowStockThreshold ?? 0,
      }))
      .sort((a, b) => a.quantity - b.quantity || a.productName.localeCompare(b.productName));
  }

  // -- Helpers ------------------------------------------------------------------

  private productInclude() {
    return {
      category: true,
      stockLevels: { include: { branch: { select: { name: true } } }, orderBy: { branchId: 'asc' as const } },
    } satisfies Prisma.ProductInclude;
  }

  private toProductDTO(tenant: TenantContext, p: ProductWithRelations, defaultTaxRate: string, branchId?: string): ProductDTO {
    const stock = p.stockLevels
      .filter((s) => canAccessBranch(tenant, s.branchId) && (!branchId || s.branchId === branchId))
      .map((s) => ({ branchId: s.branchId, branchName: s.branch.name, quantity: s.quantity }));
    const totalStock = stock.reduce((sum, s) => sum + s.quantity, 0);
    return {
      id: p.id,
      name: p.name,
      categoryId: p.categoryId,
      categoryName: p.category?.name ?? null,
      sku: p.sku,
      barcode: p.barcode,
      description: p.description,
      price: p.price.toFixed(2),
      currency: p.currency,
      taxRate: p.taxRate ? p.taxRate.toString() : null,
      effectiveTaxRate: p.taxRate ? p.taxRate.toString() : defaultTaxRate,
      costPrice: p.costPrice ? p.costPrice.toFixed(2) : null,
      isActive: p.isActive,
      trackStock: p.trackStock,
      lowStockThreshold: p.lowStockThreshold,
      imageUrl: p.imageUrl,
      stock,
      totalStock,
      lowStock: p.trackStock && p.isActive && stock.some((s) => isLowStock(s.quantity, p.lowStockThreshold)),
    };
  }

  private async trackedProduct(tenant: TenantContext, productId: string): Promise<Product> {
    const product = await this.prisma.product.findFirst({ where: { id: productId, studioId: tenant.studioId } });
    if (!product) throw retailError('RETAIL_PRODUCT_NOT_FOUND');
    if (!product.trackStock) throw retailError('RETAIL_UNTRACKED_PRODUCT');
    return product;
  }

  async assertBranch(tenant: TenantContext, branchId: string): Promise<void> {
    const branch = await this.prisma.branch.findFirst({ where: { id: branchId, studioId: tenant.studioId, isActive: true }, select: { id: true } });
    if (!branch) throw retailError('RETAIL_BRANCH_NOT_FOUND');
    assertBranchAccess(tenant, branchId);
  }

  async userNames(ids: readonly (string | null)[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
    if (unique.length === 0) return new Map();
    const users = await this.prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, firstName: true, lastName: true } });
    return new Map(users.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim()]));
  }

  private mapUnique(err: unknown): unknown {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const target = JSON.stringify(err.meta?.target ?? '');
      if (target.includes('sku')) return retailError('RETAIL_DUPLICATE_SKU');
      if (target.includes('barcode')) return retailError('RETAIL_DUPLICATE_BARCODE');
      if (target.includes('name')) return retailError('RETAIL_DUPLICATE_CATEGORY');
    }
    return err;
  }
}
