"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { IS_DEMO, DEMO_ACCOUNTS, DEMO_PASSWORD } from "@/lib/demo/store";
import { ShieldCheck, User, Users, Lock, Mail, AlertCircle, Info, Eye, EyeOff } from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";
import CursorGrid from "@/components/effects/CursorGrid";

function describeSignInError(code: string | undefined): string {
  switch (code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "That email and password combination is not recognised.";
    case "auth/invalid-email":
      return "That email address is not valid.";
    case "auth/user-disabled":
      return "This account has been disabled. Contact your administrator.";
    case "auth/too-many-requests":
      return "Too many attempts. Wait a few minutes and try again.";
    case "auth/network-request-failed":
      return "Cannot reach the server. Check your connection.";
    case "auth/configuration-not-found":
    case "auth/operation-not-allowed":
      return "Email and password sign-in is not enabled on this Firebase project.";
    case "auth/role-mismatch":
      return "Your account does not have the selected role.";
    default:
      return "Could not sign you in. Please try again.";
  }
}

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [selectedRole, setSelectedRole] = useState<"admin" | "subadmin" | "employee">("admin");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [errorCode, setErrorCode] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const router = useRouter();
  const { user, role, loading, roleError, signIn } = useAuth();

  useEffect(() => {
    if (loading || !user || !role) return;
    router.replace(`/home?role=${role}`);
  }, [user, role, loading, router]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setErrorCode("");
    setIsSubmitting(true);
    try {
      await signIn(email, password, selectedRole);
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code ?? "unknown";
      console.error("[auth] Sign-in failed:", code, err);
      setError(describeSignInError(code));
      setErrorCode(code);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f3faf9]">
        <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-emerald-600" />
      </div>
    );
  }

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-[#f3faf9] px-4 text-slate-900">
      {/* Animated CSS inside style tag */}
      <style dangerouslySetInnerHTML={{
        __html: `
        @keyframes drift {
          0% { transform: translate(0, 0) scale(1); }
          33% { transform: translate(30px, -50px) scale(1.1); }
          66% { transform: translate(-20px, 20px) scale(0.9); }
          100% { transform: translate(0, 0) scale(1); }
        }
        .animate-drift-slow {
          animation: drift 15s ease-in-out infinite;
        }
        .animate-drift-slower {
          animation: drift 20s ease-in-out infinite reverse;
        }
      `}} />

      {/* Cursor Grid Background - same as home page */}
      <CursorGrid />

      {/* Animated Gradient Blobs */}
      <div className="absolute top-1/4 left-1/4 h-[35rem] w-[35rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-400/20 blur-[120px] animate-drift-slow pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 h-[30rem] w-[30rem] translate-x-1/2 translate-y-1/2 rounded-full bg-emerald-300/20 blur-[120px] animate-drift-slower pointer-events-none" />

      {/* Main Login Card */}
      <div className="relative w-full max-w-[420px] rounded-[2rem] bg-white p-8 sm:p-10 shadow-[0_8px_30px_rgb(0,0,0,0.04)] z-10 page-enter">

        {/* Header Section */}
        <div className="mb-8 flex flex-col items-center text-center space-y-3">
          <BrandLogo className="mb-2" />

          <div className="flex items-center gap-1.5 text-emerald-600">
            {selectedRole === "admin" ? <ShieldCheck size={16} /> : selectedRole === "subadmin" ? <Users size={16} /> : <User size={16} />}
            <span className="text-xs font-semibold uppercase tracking-wider">{selectedRole === "admin" ? "Admin sign-in" : selectedRole === "subadmin" ? "Sub Admin sign-in" : "User sign-in"}</span>
          </div>

          <h1 className="text-xl font-bold text-slate-900">Lead Management System</h1>

          <div className="flex flex-col gap-1 text-sm text-slate-500">
            <p>Choose your role, then sign in</p>
            <p dir="rtl" className="text-[13px] opacity-70">اپنا کردار منتخب کریں، پھر سائن ان کریں</p>
          </div>
        </div>

        {roleError && (
          <div className="mb-6 flex items-start gap-2.5 rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-xs font-medium text-amber-600">
            <AlertCircle size={16} className="mt-px shrink-0" />
            <span>{roleError}</span>
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-5">

          {/* Role selector.
              Three roles now, so the toggle is generated rather than written
              out three times — the previous pair had the whole button markup
              duplicated, and a third copy is where the styling starts to
              drift. The label is the role's own word from
              `lib/constants/hierarchy`, so it cannot disagree with the rest of
              the product. */}
          <div className="flex w-full rounded-xl border border-slate-100 bg-slate-50/50 p-1">
            {([
              { key: "admin", label: "Admin", Icon: ShieldCheck },
              { key: "subadmin", label: "Sub Admin", Icon: Users },
              { key: "employee", label: "User", Icon: User },
            ] as const).map(({ key, label, Icon }) => {
              const active = selectedRole === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSelectedRole(key)}
                  aria-pressed={active}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2.5 text-[13px] font-semibold transition-all ${
                    active
                      ? "bg-white text-emerald-600 shadow-[0_2px_10px_rgb(0,0,0,0.04)] border border-emerald-100/50"
                      : "text-slate-500 hover:text-slate-700 hover:bg-slate-100/50"
                  }`}
                >
                  <Icon size={15} className={active ? "text-emerald-500" : ""} />
                  {label}
                </button>
              );
            })}
          </div>

          {/* Email Input */}
          <div className="space-y-1.5">
            <label htmlFor="email" className="flex items-center gap-1.5 text-sm font-semibold text-slate-700">
              Email <span dir="rtl" className="text-xs font-normal text-slate-400">(ای میل)</span>
            </label>
            <div className="relative flex items-center group">
              <Mail className="absolute left-3.5 text-slate-400 group-focus-within:text-emerald-500 transition-colors" size={18} />
              <input
                id="email"
                type="email"
                required
                autoComplete="username"
                className="w-full rounded-xl border border-slate-200 bg-white py-3 pl-10 pr-4 text-sm text-slate-900 outline-none transition-all focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email address"
              />
            </div>
          </div>

          {/* Password Input */}
          <div className="space-y-1.5">
            <label htmlFor="password" className="flex items-center gap-1.5 text-sm font-semibold text-slate-700">
              Password <span dir="rtl" className="text-xs font-normal text-slate-400">(پاس ورڈ)</span>
            </label>
            <div className="relative flex items-center group">
              <Lock className="absolute left-3.5 text-slate-400 group-focus-within:text-emerald-500 transition-colors" size={18} />
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                required
                autoComplete="current-password"
                className="w-full rounded-xl border border-slate-200 bg-white py-3 pl-10 pr-10 text-sm text-slate-900 outline-none transition-all focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3.5 text-slate-400 hover:text-slate-600 focus:outline-none"
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          {error && (
            <div className="space-y-1 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-xs font-medium text-red-500">
              <p>{error}</p>
              {process.env.NODE_ENV !== "production" && errorCode && (
                <p className="font-mono text-[11px] text-red-500/60">{errorCode}</p>
              )}
            </div>
          )}

          <div className="pt-2">
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full rounded-xl bg-emerald-600 py-3.5 text-sm font-semibold text-white shadow-lg shadow-emerald-600/20 transition-all hover:bg-emerald-700 hover:shadow-emerald-600/30 focus:outline-none focus:ring-4 focus:ring-emerald-600/20 disabled:opacity-50"
            >
              {isSubmitting ? "Signing in…" : "Sign in"}
            </button>
          </div>
        </form>

        <div className="mt-8 text-center text-xs text-slate-500">
          <p>
            First time here? <a href="#" className="font-semibold text-emerald-600 hover:underline">Create the account</a>
          </p>
          <p className="mt-1 opacity-70">(verified by an emailed code)</p>
        </div>

        {/* Demo Accounts Helper - kept for development convenience */}
        {IS_DEMO && (
          <div className="mt-8 space-y-2 border-t border-slate-100 pt-6">
            <p className="flex items-center justify-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-amber-600">
              <Info size={12} /> Demo accounts
            </p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-2">
              {DEMO_ACCOUNTS.map((account) => (
                <button
                  key={account.uid}
                  type="button"
                  onClick={() => {
                    setEmail(account.email);
                    setPassword(DEMO_PASSWORD);
                    setSelectedRole(account.role);
                  }}
                  className="flex flex-col rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-left text-[10px] transition-colors hover:border-emerald-300 hover:bg-emerald-50"
                >
                  <span className="font-semibold text-slate-900 truncate w-full">{account.email}</span>
                  <span className="capitalize text-slate-500">{account.role}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}