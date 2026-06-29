import {
  countFollowers,
  countFollowing,
  countPublicRoutesForOwner,
  ensureUserProfile,
  getLastGroupMessage,
  getUserProfile,
  listGroupMembers,
  type GroupRow,
  type UserProfileRow,
} from "@/lib/db";
import { GROUP_TYPE_LABELS, LEVEL_LABELS } from "@/lib/social-labels";

export function serializeProfile(
  row: UserProfileRow,
  extras?: { followers?: number; following?: number; public_routes?: number }
) {
  return {
    username: row.username,
    display_name: row.display_name || row.username,
    bio: row.bio,
    avatar_path: row.avatar_path,
    home_area: row.home_area,
    level: row.level,
    level_label: LEVEL_LABELS[row.level],
    followers: extras?.followers ?? countFollowers(row.username),
    following: extras?.following ?? countFollowing(row.username),
    public_routes: extras?.public_routes ?? countPublicRoutesForOwner(row.username),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function profileForUsername(username: string) {
  const row = ensureUserProfile(username);
  return serializeProfile(row);
}

export function serializeGroupSummary(group: GroupRow, viewerUsername?: string) {
  const last = getLastGroupMessage(group.id);
  const members = listGroupMembers(group.id);
  return {
    id: group.id,
    name: group.name,
    type: group.type,
    type_label: GROUP_TYPE_LABELS[group.type],
    description: group.description,
    avatar_path: group.avatar_path,
    created_by: group.created_by,
    route_id: group.route_id,
    member_count: members.length,
    members: members.map((m) => ({ username: m.username, role: m.role })),
    last_message: last
      ? { from_user: last.from_user, body: last.body, created_at: last.created_at }
      : null,
    created_at: group.created_at,
    updated_at: group.updated_at,
    is_member: viewerUsername
      ? members.some((m) => m.username === viewerUsername)
      : undefined,
  };
}
