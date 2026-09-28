'use client';

import { useEffect, useRef, useState } from 'react';

export function EarningsCalculator() {
  const sliderRef = useRef<HTMLInputElement>(null);
  const [hours, setHours] = useState(25);
  const animRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const directionRef = useRef<1 | -1>(1);
  const userPauseRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const MIN = 5;
  const MAX = 60;

  const calc = (h: number) => {
    const deliveries = Math.round(h * 3);
    const per = (12 + 5) * 1.15;
    return Math.round(per * deliveries * 4.33);
  };

  const monthly = calc(hours);

  const fmt = (n: number) => n.toLocaleString('ar-SA') + ' ر.س';

  useEffect(() => {
    const slider = sliderRef.current;
    if (!slider) return;

    const tick = () => {
      setHours((prev) => {
        let next = prev + directionRef.current;
        if (next >= MAX) {
          next = MAX;
          directionRef.current = -1;
        } else if (next <= MIN) {
          next = MIN;
          directionRef.current = 1;
        }
        return next;
      });
    };

    const startAnim = () => {
      stopAnim();
      animRef.current = setInterval(tick, 900);
    };

    const stopAnim = () => {
      if (animRef.current) {
        clearInterval(animRef.current);
        animRef.current = null;
      }
    };

    const handleInput = () => {
      const v = parseInt(slider.value, 10);
      setHours(Number.isFinite(v) ? v : MIN);
      stopAnim();
      if (userPauseRef.current) clearTimeout(userPauseRef.current);
      userPauseRef.current = setTimeout(() => {
        startAnim();
      }, 2500);
    };

    const handleChange = () => {
      if (userPauseRef.current) clearTimeout(userPauseRef.current);
      startAnim();
    };

    slider.addEventListener('input', handleInput);
    slider.addEventListener('change', handleChange);
    startAnim();

    return () => {
      stopAnim();
      if (userPauseRef.current) clearTimeout(userPauseRef.current);
      slider.removeEventListener('input', handleInput);
      slider.removeEventListener('change', handleChange);
    };
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <label className="block text-sm font-bold text-gray-700 mb-2">
          ساعات الشغل في الأسبوع
        </label>
        <div className="flex items-center gap-4">
          <input
            ref={sliderRef}
            id="hours-slider"
            type="range"
            min={MIN}
            max={MAX}
            value={hours}
            onChange={(e) => setHours(parseInt(e.target.value, 10))}
            className="flex-1 accent-primary"
            dir="ltr"
          />
          <div className="bg-primary-50 text-primary font-bold px-4 py-2 min-w-[80px] text-center rounded-lg transition-all">
            <span className="tabular-nums">{hours}</span> ساعة
          </div>
        </div>
        <div className="flex justify-between text-xs text-gray-400 mt-1" dir="ltr">
          <span>5h</span>
          <span>60h</span>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 pt-4 border-t border-gray-100">
        <div className="text-center p-4 bg-primary-50 rounded-xl">
          <div className="text-xs text-gray-600 mb-1">الأرباح الشهرية المتوقعة</div>
          <div className="text-2xl font-extrabold text-primary tabular-nums transition-all">
            {fmt(monthly)}
          </div>
        </div>
        <div className="text-center p-4 bg-gray-50 rounded-xl">
          <div className="text-xs text-gray-600 mb-1">لكل توصيلة</div>
          <div className="text-lg font-bold text-gray-900">12 ر.س</div>
        </div>
        <div className="text-center p-4 bg-gray-50 rounded-xl">
          <div className="text-xs text-gray-600 mb-1">متوسط الإكراميات</div>
          <div className="text-lg font-bold text-gray-900">5 ر.س</div>
        </div>
      </div>
    </div>
  );
}