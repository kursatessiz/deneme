import {
  AccessTierRuleInputSchema,
  COMMUNITY_COMMENT_MAX,
  CreateAccessTierSchema,
  CreateCommunityCommentSchema,
  CreateCommunityPostSchema,
  UpdateCommunityPostSchema,
  communityDisplayName,
  communityPostShapeIssue,
} from './community';

const VIDEO_ID = '11111111-1111-4111-8111-111111111111';

describe('community post shape', () => {
  it('VIDEO needs a video, FILE needs a link, other types never carry a video', () => {
    expect(communityPostShapeIssue({ type: 'VIDEO', videoContentId: null, attachmentUrl: null })).toBe('videoContentId');
    expect(communityPostShapeIssue({ type: 'VIDEO', videoContentId: VIDEO_ID, attachmentUrl: null })).toBeNull();
    expect(communityPostShapeIssue({ type: 'FILE', videoContentId: null, attachmentUrl: null })).toBe('attachmentUrl');
    expect(communityPostShapeIssue({ type: 'POST', videoContentId: VIDEO_ID, attachmentUrl: null })).toBe('videoContentId');
    expect(communityPostShapeIssue({ type: 'ANNOUNCEMENT', videoContentId: null, attachmentUrl: null })).toBeNull();
  });

  it('create applies defaults and rejects a non-https attachment', () => {
    const parsed = CreateCommunityPostSchema.parse({ type: 'POST', title: ' Merhaba ' });
    expect(parsed).toMatchObject({ title: 'Merhaba', body: '', pinned: false, commentsEnabled: true, tierIds: [] });
    expect(CreateCommunityPostSchema.safeParse({ type: 'FILE', title: 'x', attachmentUrl: 'http://example.com/a.pdf' }).success).toBe(false);
    expect(CreateCommunityPostSchema.safeParse({ type: 'FILE', title: 'x', attachmentUrl: 'https://example.com/a.pdf' }).success).toBe(true);
    expect(CreateCommunityPostSchema.safeParse({ type: 'VIDEO', title: 'x' }).success).toBe(false);
    expect(CreateCommunityPostSchema.safeParse({ type: 'POST', title: 'x', unknown: 1 }).success).toBe(false);
  });

  it('update needs at least one field', () => {
    expect(UpdateCommunityPostSchema.safeParse({}).success).toBe(false);
    expect(UpdateCommunityPostSchema.safeParse({ pinned: true }).success).toBe(true);
  });
});

describe('comments', () => {
  it('trims and limits the body', () => {
    expect(CreateCommunityCommentSchema.safeParse({ body: '   ' }).success).toBe(false);
    expect(CreateCommunityCommentSchema.safeParse({ body: 'a'.repeat(COMMUNITY_COMMENT_MAX + 1) }).success).toBe(false);
    expect(CreateCommunityCommentSchema.parse({ body: ' merhaba ' }).body).toBe('merhaba');
  });

  it('display name is first name and last initial', () => {
    expect(communityDisplayName('Deniz', 'arslan')).toBe('Deniz A.');
    expect(communityDisplayName('Deniz', '')).toBe('Deniz');
  });
});

describe('access tier rules', () => {
  it('a package rule names its package; other kinds never do', () => {
    expect(AccessTierRuleInputSchema.safeParse({ kind: 'PACKAGE_DEFINITION' }).success).toBe(false);
    expect(AccessTierRuleInputSchema.safeParse({ kind: 'PACKAGE_DEFINITION', packageDefinitionId: VIDEO_ID }).success).toBe(true);
    expect(AccessTierRuleInputSchema.safeParse({ kind: 'ACTIVE_MEMBER', packageDefinitionId: VIDEO_ID }).success).toBe(false);
    expect(AccessTierRuleInputSchema.safeParse({ kind: 'ACTIVE_PACKAGE' }).success).toBe(true);
  });

  it('a tier needs at least one rule', () => {
    expect(CreateAccessTierSchema.safeParse({ name: 'Katman', rules: [] }).success).toBe(false);
    expect(CreateAccessTierSchema.safeParse({ name: 'Katman', rules: [{ kind: 'ACTIVE_MEMBER' }] }).success).toBe(true);
  });
});
