import type { updateIssueDetailAction } from "@/app/actions";
import type { ActivityEvent, Comment, Issue, IssueChild, Label } from "@/lib/issues";

export type FlatDetail = Issue & {
  labels: Label[];
  comments: Comment[];
  events: ActivityEvent[];
  children: IssueChild[];
};

export type IssuePatch = Parameters<typeof updateIssueDetailAction>[2];

export type IssueUpdate = (patch: IssuePatch) => Promise<boolean>;
