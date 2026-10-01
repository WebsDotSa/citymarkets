"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, ArrowRight, Gift } from "lucide-react";

interface SpinResult {
  id: string;
  prize_type: string;
  prize_value: number;
  is_winner: boolean;
}

interface SpinData {
  can_spin: boolean;
  remaining_spins: number;
  last_result: SpinResult | null;
}

const PRIZES = [
  { label: "🎁", value: 50, color: "#FF6B6B" },
  { label: "⭐", value: 100, color: "#4ECDC4" },
  { label: "🎀", value: 20, color: "#FFE66D" },
  { label: "🌟", value: 75, color: "#95E1D3" },
  { label: "🎉", value: 30, color: "#DDA0DD" },
  { label: "✨", value: 150, color: "#98D8C8" },
  { label: "💎", value: 200, color: "#F7DC6F" },
  { label: "🎊", value: 10, color: "#BB8FCE" },
];

export default function SpinPage() {
  const router = useRouter();
  const [data, setData] = useState<SpinData | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState<SpinResult | null>(null);
  const [rotation, setRotation] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const wheelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const res = await fetch("/api/v1/spin", { credentials: "include" });
      if (res.status === 401) {
        router.push("/auth/login?redirect=/spin");
        return;
      }
      const json = await res.json();
      setData(json);
    } catch {
      setError("فشل في تحميل البيانات");
    }
  };

  const spin = async () => {
    if (!data?.can_spin || spinning) return;

    setSpinning(true);
    setResult(null);

    try {
      const res = await fetch("/api/v1/spin", {
        method: "POST",
        credentials: "include",
      });
      const json = await res.json();

      if (!json.success) {
        setError(json.error || "فشل في تدوير العجلة");
        setSpinning(false);
        return;
      }

      const spinResult = json.data;
      setResult(spinResult);

      // Calculate rotation
      const prizeIndex = PRIZES.findIndex(
        (p) => p.value === spinResult.prize_value
      );
      const segmentAngle = 360 / PRIZES.length;
      const targetAngle = 360 - prizeIndex * segmentAngle - segmentAngle / 2;
      const spins = 5 + Math.random() * 3;
      const newRotation = rotation + spins * 360 + targetAngle;

      setRotation(newRotation);

      // Wait for animation
      await new Promise((resolve) => setTimeout(resolve, 5000));

      // Refresh data
      fetchData();
    } catch {
      setError("فشل في تدوير العجلة");
    } finally {
      setSpinning(false);
    }
  };

  if (error) {
    return (
      <main className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center">
          <p className="text-red-600 mb-4">{error}</p>
          <button onClick={fetchData} className="text-primary underline">
            إعادة المحاولة
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-[#009345] to-[#007A38] flex flex-col items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-2xl p-8 max-w-md w-full text-center">
        <div className="flex items-center justify-center gap-2 mb-6">
          <Sparkles className="w-6 h-6 text-primary" />
          <h1 className="text-2xl font-bold text-gray-900">عجلة الحظ</h1>
        </div>

        {/* Wheel */}
        <div className="relative w-72 h-72 mx-auto mb-8">
          {/* Pointer */}
          <div className="absolute top-0 start-1/2 -translate-x-1/2 -translate-y-2 z-10">
            <div className="w-0 h-0 border-s-8 border-e-8 border-t-12 border-s-transparent border-e-transparent border-t-[#009345] drop-shadow-md" />
          </div>

          {/* Wheel */}
          <div
            ref={wheelRef}
            className="w-full h-full rounded-full border-4 border-primary overflow-hidden transition-transform duration-[5000ms] ease-out"
            style={{ transform: `rotate(${rotation}deg)` }}
          >
            <div className="relative w-full h-full">
              {PRIZES.map((prize, i) => {
                const angle = (360 / PRIZES.length) * i;
                return (
                  <div
                    key={i}
                    className="absolute w-1/2 h-1/2 start-1/2 top-0 origin-bottom flex items-center justify-center"
                    style={{
                      transform: `translateX(-50%) rotate(${angle}deg) translateY(50%)`,
                      backgroundColor: prize.color,
                    }}
                  >
                    <span
                      className="absolute top-1/2 start-1/2 -translate-x-1/2 -translate-y-1/2 text-2xl"
                      style={{ transform: `translateX(-50%) translateY(-50%) rotate(${angle}deg)` }}
                    >
                      {prize.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Center */}
          <div className="absolute top-1/2 start-1/2 -translate-x-1/2 -translate-y-1/2 w-12 h-12 bg-white rounded-full shadow-lg flex items-center justify-center border-2 border-primary">
            <Gift className="w-6 h-6 text-primary" />
          </div>
        </div>

        {/* Status */}
        {data && (
          <div className="mb-6">
            {data.can_spin ? (
              <p className="text-gray-600">
                لديك <span className="font-bold text-primary">{data.remaining_spins}</span> فرصة للتدوير
              </p>
            ) : (
              <p className="text-gray-500">
                استخدمت جميع الفرص المتاحة. عد明天 للمزيد!
              </p>
            )}
          </div>
        )}

        {/* Spin Button */}
        <button
          onClick={spin}
          disabled={!data?.can_spin || spinning}
          className={`w-full py-4 rounded-xl font-bold text-lg transition-all ${
            data?.can_spin && !spinning
              ? "bg-primary text-white hover:bg-primary-dark shadow-lg hover:shadow-xl"
              : "bg-gray-200 text-gray-400 cursor-not-allowed"
          }`}
        >
          {spinning ? "جاري التدوير..." : "أدور العجلة"}
        </button>

        {/* Result Modal */}
        {result && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-2xl p-8 max-w-sm w-full text-center animate-bounce-in">
              <div className="text-6xl mb-4">
                {result.is_winner ? "🎉" : "😅"}
              </div>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">
                {result.is_winner ? "مبروك!" : "حاول مرة ثانية"}
              </h2>
              {result.is_winner && (
                <p className="text-gray-600 mb-4">
                  ربحت <span className="font-bold text-primary">{result.prize_value}</span> نقطة!
                </p>
              )}
              <div className="flex gap-3">
                <button
                  onClick={() => setResult(null)}
                  className="flex-1 py-3 bg-gray-100 text-gray-700 rounded-xl font-semibold"
                >
                  إغلاق
                </button>
                <button
                  onClick={() => {
                    setResult(null);
                    router.push("/profile/loyalty");
                  }}
                  className="flex-1 py-3 bg-primary text-white rounded-xl font-semibold flex items-center justify-center gap-2"
                >
                  نقاطي
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
