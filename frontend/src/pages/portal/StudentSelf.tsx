import { StudentProfileView } from "./StudentProfile";
import { Account } from "./System";

export default function StudentSelf() {
  return (
    <>
      <StudentProfileView id="me" self />
      <div className="mt-8"><Account /></div>
    </>
  );
}
