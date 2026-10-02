import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "@/lib/auth";
import { SchoolProvider } from "@/lib/school";
import { ToastProvider } from "@/lib/hooks";
import { ConfirmProvider, PageLoader } from "@/components/ui";
import { PublicLayout } from "@/components/Layouts";
import { PortalLayout, RequirePerm } from "@/components/PortalLayout";
import { Link } from "react-router-dom";

import Home from "@/pages/public/Home";
import CheckResult from "@/pages/public/CheckResult";
import { Login, ForgotPassword, ResetPassword } from "@/pages/public/Auth";

const About = lazy(() => import("@/pages/public/About"));
const Admissions = lazy(() => import("@/pages/public/Admissions"));
const News = lazy(() => import("@/pages/public/News"));
const Contact = lazy(() => import("@/pages/public/News").then((m) => ({ default: m.Contact })));
const Verify = lazy(() => import("@/pages/public/Verify"));

const Dashboard = lazy(() => import("@/pages/portal/Dashboard"));
const Students = lazy(() => import("@/pages/portal/Students"));
const StudentProfile = lazy(() => import("@/pages/portal/StudentProfile"));
const StudentSelf = lazy(() => import("@/pages/portal/StudentSelf"));
const Teachers = lazy(() => import("@/pages/portal/Teachers"));
const Academics = lazy(() => import("@/pages/portal/Academics"));
const ResultEntry = lazy(() => import("@/pages/portal/ResultEntry"));
const Approvals = lazy(() => import("@/pages/portal/Approvals"));
const Amendments = lazy(() => import("@/pages/portal/Approvals").then((m) => ({ default: m.Amendments })));
const ClassReports = lazy(() => import("@/pages/portal/ClassReports"));
const ResultCodes = lazy(() => import("@/pages/portal/ResultCodes"));
const Materials = lazy(() => import("@/pages/portal/Materials"));
const Announcements = lazy(() => import("@/pages/portal/Announcements"));
const AdmissionsReview = lazy(() => import("@/pages/portal/Announcements").then((m) => ({ default: m.AdmissionsReview })));
const MyResults = lazy(() => import("@/pages/portal/ResultViews"));
const ReportPage = lazy(() => import("@/pages/portal/ResultViews").then((m) => ({ default: m.ReportPage })));
const Settings = lazy(() => import("@/pages/portal/Settings"));
const sys = (name: string) => lazy(() => import("@/pages/portal/System").then((m) => ({ default: (m as Record<string, React.ComponentType>)[name] })));
const Notifications = sys("Notifications");
const AuditLog = sys("AuditLog");
const Users = sys("Users");
const Permissions = sys("Permissions");
const Backups = sys("Backups");
const Account = sys("Account");

const NotFound = () => (
  <div className="grid min-h-[60vh] place-items-center px-4 text-center">
    <div><div className="font-display text-7xl font-semibold text-brand-700">404</div><p className="mt-2 text-lg text-muted">We couldn't find that page.</p><Link to="/" className="mt-5 inline-block font-semibold text-brand-700 underline">Back to home</Link></div>
  </div>
);

const Fallback = <div className="mx-auto max-w-3xl p-8"><PageLoader rows={4} /></div>;

export default function App() {
  return (
    <BrowserRouter>
      <SchoolProvider>
        <AuthProvider>
          <ToastProvider>
            <ConfirmProvider>
              <Suspense fallback={Fallback}>
                <Routes>
                  <Route element={<PublicLayout />}>
                    <Route index element={<Home />} />
                    <Route path="about" element={<About />} />
                    <Route path="admissions" element={<Admissions />} />
                    <Route path="news" element={<News />} />
                    <Route path="contact" element={<Contact />} />
                    <Route path="check-result" element={<CheckResult />} />
                    <Route path="verify" element={<Verify />} />
                    <Route path="verify/:ref" element={<Verify />} />
                    <Route path="login" element={<Login />} />
                    <Route path="forgot-password" element={<ForgotPassword />} />
                    <Route path="reset-password" element={<ResetPassword />} />
                  </Route>

                  <Route path="portal" element={<PortalLayout />}>
                    <Route index element={<Dashboard />} />
                    <Route path="students" element={<RequirePerm perm="students.read" roles={["SUPER_ADMIN", "ADMIN", "TEACHER"]}><Students /></RequirePerm>} />
                    <Route path="students/:id" element={<RequirePerm perm="students.read" roles={["SUPER_ADMIN", "ADMIN", "TEACHER"]}><StudentProfile /></RequirePerm>} />
                    <Route path="teachers" element={<RequirePerm perm="teachers.write"><Teachers /></RequirePerm>} />
                    <Route path="users" element={<RequirePerm perm="users.manage"><Users /></RequirePerm>} />
                    <Route path="academics" element={<RequirePerm perm="academics.write"><Academics /></RequirePerm>} />
                    <Route path="results" element={<RequirePerm perm="results.write" roles={["SUPER_ADMIN", "ADMIN", "TEACHER"]}><ResultEntry /></RequirePerm>} />
                    <Route path="approvals" element={<RequirePerm perm="results.approve" roles={["SUPER_ADMIN", "ADMIN"]}><Approvals /></RequirePerm>} />
                    <Route path="amendments" element={<RequirePerm perm="results.amend" roles={["SUPER_ADMIN", "ADMIN", "TEACHER"]}><Amendments /></RequirePerm>} />
                    <Route path="reports" element={<RequirePerm perm="reports.read" roles={["SUPER_ADMIN", "ADMIN", "TEACHER"]}><ClassReports /></RequirePerm>} />
                    <Route path="report/:cardId" element={<RequirePerm perm="results.read"><ReportPage /></RequirePerm>} />
                    <Route path="codes" element={<RequirePerm perm="codes.manage"><ResultCodes /></RequirePerm>} />
                    <Route path="materials" element={<RequirePerm perm="materials.read"><Materials /></RequirePerm>} />
                    <Route path="announcements" element={<Announcements />} />
                    <Route path="admissions" element={<RequirePerm perm="admissions.manage"><AdmissionsReview /></RequirePerm>} />
                    <Route path="my-results" element={<RequirePerm roles={["STUDENT"]}><MyResults /></RequirePerm>} />
                    <Route path="profile" element={<RequirePerm roles={["STUDENT"]}><StudentSelf /></RequirePerm>} />
                    <Route path="notifications" element={<Notifications />} />
                    <Route path="audit" element={<RequirePerm perm="audit.read"><AuditLog /></RequirePerm>} />
                    <Route path="permissions" element={<RequirePerm perm="permissions.manage"><Permissions /></RequirePerm>} />
                    <Route path="backups" element={<RequirePerm perm="backups.manage"><Backups /></RequirePerm>} />
                    <Route path="settings" element={<RequirePerm perm="settings.manage"><Settings /></RequirePerm>} />
                    <Route path="account" element={<Account />} />
                  </Route>

                  <Route element={<PublicLayout />}><Route path="*" element={<NotFound />} /></Route>
                  <Route path="/index.html" element={<Navigate to="/" replace />} />
                </Routes>
              </Suspense>
            </ConfirmProvider>
          </ToastProvider>
        </AuthProvider>
      </SchoolProvider>
    </BrowserRouter>
  );
}
