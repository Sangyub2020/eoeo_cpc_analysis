import FeedbackBoard from "@/components/feedback/FeedbackBoard";

export const dynamic = "force-dynamic";

export default function FeedbackPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold bg-gradient-to-r from-cyan-400 to-purple-400 bg-clip-text text-transparent">
          건의 · 피드백
        </h1>
        <p className="text-gray-400 mt-2">
          대시보드에서 고치고 싶은 점, 추가했으면 하는 기능, 버그 등을 남겨주세요.
        </p>
      </div>
      <FeedbackBoard />
    </div>
  );
}
