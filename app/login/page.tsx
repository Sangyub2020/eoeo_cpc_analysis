import { Suspense } from "react";
import LoginForm from "./LoginForm";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <div className="max-w-sm mx-auto mt-24">
      <h1 className="text-3xl font-bold bg-gradient-to-r from-cyan-400 to-purple-400 bg-clip-text text-transparent mb-2">
        로그인
      </h1>
      <p className="text-gray-400 mb-6">Google 계정(@egongegong.com)으로 로그인해주세요.</p>
      <Suspense>
        <LoginForm />
      </Suspense>
    </div>
  );
}
