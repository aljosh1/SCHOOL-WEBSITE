import { get, type Rec } from "./api";
import { useFetch } from "./hooks";

/** Sessions, classes and subjects are small lists used by many forms. */
export function useLookups() {
  const sessions = useFetch(() => get<Rec[]>("/api/sessions"), []);
  const classes = useFetch(() => get<Rec[]>("/api/classes"), []);
  const subjects = useFetch(() => get<Rec[]>("/api/subjects"), []);
  const loading = sessions.loading || classes.loading || subjects.loading;
  const error = sessions.error ?? classes.error ?? subjects.error;
  const current = sessions.data?.find((s) => s.is_current) ?? sessions.data?.[0];
  const currentTerm = current?.terms.find((t: Rec) => t.is_current) ?? current?.terms[0];
  return {
    sessions: sessions.data ?? [], classes: classes.data ?? [], subjects: subjects.data ?? [], loading, error,
    current, currentTerm,
    reload: () => { sessions.reload(); classes.reload(); subjects.reload(); },
  };
}
