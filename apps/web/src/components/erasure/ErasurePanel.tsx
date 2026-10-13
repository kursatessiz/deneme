"use client";

import { useCallback, useEffect, useState } from "react";
import type { ErasureRequestDTO, SelfErasureStatusDTO } from "@platform/shared";
import { useLocale, useT } from "@/components/i18n/I18nProvider";
import { useDashboardSession } from "@/components/session/DashboardSessionProvider";
import { PermissionButton } from "@/components/common/PermissionButton";
import { bffFetch, BffError } from "@/lib/session/client";
import { hasAnyPermission } from "@/lib/nav";
import { LinkButton } from "@/components/ui/LinkButton";
import { useConfirm, useToast } from "@/components/ui";

/**
 * Personal data section of the member card (docs/KVKK_SILME.md). Visible
 * only with `members.erase`: shows the open request of the member (approve
 * or reject it here or in the request list) and lets staff start erasure
 * directly after a confirmation. The API enforces the same permission.
 */
export function ErasurePanel({
  studioId,
  memberId,
  erasedAt,
  onChanged,
}: {
  studioId: string;
  memberId: string;
  erasedAt: string | null;
  onChanged: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const { confirm, prompt } = useConfirm();
  const toast = useToast();
  const { permissions, isOwner } = useDashboardSession();
  const allowed = hasAnyPermission(["members.erase"], permissions, isOwner);
  const [request, setRequest] = useState<ErasureRequestDTO | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    if (!allowed || !studioId) return;
    bffFetch<SelfErasureStatusDTO>(
      `studios/${studioId}/members/${memberId}/erasure`,
      { studioId },
    )
      .then((res) => setRequest(res.request))
      .catch(() => setRequest(null));
  }, [allowed, studioId, memberId]);

  useEffect(() => {
    load();
  }, [load, erasedAt]);

  if (!allowed) return null;

  const formatDate = (iso: string) => new Date(iso).toLocaleDateString(locale);
  const open =
    request && (request.status === "PENDING" || request.status === "APPROVED")
      ? request
      : null;

  async function run(action: () => Promise<unknown>, successMessage: string) {
    setBusy(true);
    try {
      await action();
      toast.show(successMessage, "success");
      onChanged();
      load();
    } catch (err) {
      toast.error(
        err instanceof BffError
          ? err.message
          : t("erasure.errors.actionFailed"),
      );
    } finally {
      setBusy(false);
    }
  }

  async function start() {
    if (
      !(await confirm({
        message: t("erasure.card.confirmMessage"),
        confirmLabel: t("erasure.card.confirmLabel"),
        danger: true,
      }))
    )
      return;
    await run(
      () =>
        bffFetch(`studios/${studioId}/members/${memberId}/erasure`, {
          method: "POST",
          studioId,
          body: {},
        }),
      t("erasure.card.started"),
    );
  }

  async function approve(row: ErasureRequestDTO) {
    if (
      !(await confirm({
        message: t("erasure.list.approveConfirm"),
        confirmLabel: t("erasure.list.approveConfirmLabel"),
        danger: true,
      }))
    )
      return;
    await run(
      () =>
        bffFetch(`studios/${studioId}/erasure-requests/${row.id}/approve`, {
          method: "POST",
          studioId,
          body: {},
        }),
      t("erasure.list.approved"),
    );
  }

  async function reject(row: ErasureRequestDTO) {
    const note = await prompt({
      message: t("erasure.list.rejectConfirm"),
      confirmLabel: t("erasure.list.rejectConfirmLabel"),
      inputLabel: t("erasure.list.rejectReasonLabel"),
    });
    if (note === null) return;
    await run(
      () =>
        bffFetch(`studios/${studioId}/erasure-requests/${row.id}/reject`, {
          method: "POST",
          studioId,
          body: note.trim() ? { note: note.trim() } : {},
        }),
      t("erasure.list.rejected"),
    );
  }

  return (
    <section className="pui-card">
      <div className="pui-card-header">
        <h3 className="ui-heading">{t("erasure.card.title")}</h3>
      </div>
      <div className="pui-card-content gap-3">
        {erasedAt ? (
          <p>
            {t("erasure.card.erasedNotice", { date: formatDate(erasedAt) })}
          </p>
        ) : (
          <>
            <p className="ui-text-muted">{t("erasure.card.description")}</p>
            {open?.status === "PENDING" && (
              <p>
                {t("erasure.card.pendingNotice", {
                  date: formatDate(open.dueAt),
                })}
              </p>
            )}
            {open?.status === "APPROVED" && (
              <p>{t("erasure.card.approvedNotice")}</p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              {open?.status === "PENDING" && (
                <>
                  <PermissionButton
                    required={["members.erase"]}
                    variant="primary"
                    disabled={busy}
                    onClick={() => approve(open)}
                  >
                    {t("erasure.card.approve")}
                  </PermissionButton>
                  <PermissionButton
                    required={["members.erase"]}
                    variant="secondary"
                    disabled={busy}
                    onClick={() => reject(open)}
                  >
                    {t("erasure.card.reject")}
                  </PermissionButton>
                </>
              )}
              {!open && (
                <PermissionButton
                  required={["members.erase"]}
                  variant="danger"
                  disabled={busy}
                  onClick={start}
                >
                  {t("erasure.card.start")}
                </PermissionButton>
              )}
              <LinkButton
                href="/members/silme-talepleri"
                variant="link"
                tone="muted"
                size="sm"
              >
                {t("erasure.card.requestsLink")}
              </LinkButton>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
