import {useAppSelector} from "@/store/hooks";
import {selectTradeIssues} from "@/store/selectors";

export interface FieldIssue {
    message: string;
    source: "client" | "backend";
    severity: "error" | "warning";
    knownIds?: string[];
}

/** One lookup for both sources of truth about a field.
 *
 *  A client-side complaint and a backend field_path name the same dotted path,
 *  so a control asks once and gets whichever applies. The backend wins: it saw
 *  the frame we actually sent.
 */
export function useFieldIssue(path: string): FieldIssue | null {
    const rejection = useAppSelector(state => state.ui.rejection);
    const issues = useAppSelector(selectTradeIssues);

    if (rejection && samePath(rejection.fieldPath, path)) {
        return {
            message: `${rejection.message} — ${rejection.remedy}`,
            source: "backend",
            severity: "error",
            ...(rejection.knownIds.length > 0 ? {knownIds: rejection.knownIds} : {})
        };
    }
    const issue = issues.find(candidate => samePath(candidate.path, path));
    return issue ? {message: issue.message, source: "client", severity: issue.severity} : null;
}

export function useFieldError(path: string): string | undefined {
    const issue = useFieldIssue(path);
    return issue?.severity === "error" ? issue.message : undefined;
}

/** The backend indexes repeated fields — "exercise.dates[0]" — and a control
 *  that owns the whole list registers the unindexed path. Compare with the
 *  indices removed so the highlight lands rather than being dropped for a
 *  "[0]". */
function samePath(a: string, b: string): boolean {
    return a.replace(/\[\d+\]/g, "") === b.replace(/\[\d+\]/g, "");
}
