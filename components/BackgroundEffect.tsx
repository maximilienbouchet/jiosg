"use client";

export function BackgroundEffect() {
  return (
    <div
      className="fixed inset-0 -z-10 overflow-hidden pointer-events-none animate-hue-shift motion-reduce:[animation-duration:200s]"
      aria-hidden="true"
    >
      {/* Warm amber — top-left, large, most visible */}
      <div className="absolute -top-[30%] -left-[20%] w-[80vw] h-[70vh] rounded-full
        bg-[var(--color-accent)] opacity-[0.15] blur-[120px] will-change-transform
        animate-drift-1 motion-reduce:[animation-duration:200s]" />
      {/* Cool blue — bottom-right, large */}
      <div className="absolute -bottom-[20%] -right-[20%] w-[70vw] h-[80vh] rounded-full
        bg-[var(--color-link)] opacity-[0.13] blur-[120px] will-change-transform
        animate-drift-2 motion-reduce:[animation-duration:200s]" />
      {/* Purple — center-right, medium */}
      <div className="absolute top-[20%] right-[10%] w-[50vw] h-[50vh] rounded-full
        bg-[#7C3AED] opacity-[0.11] blur-[150px] will-change-transform
        animate-drift-3 motion-reduce:[animation-duration:200s]" />
      {/* Teal accent — bottom-left, smallest, adds surprise color */}
      <div className="absolute bottom-[10%] left-[20%] w-[40vw] h-[40vh] rounded-full
        bg-[#14B8A6] opacity-[0.09] blur-[130px] will-change-transform
        animate-drift-4 motion-reduce:[animation-duration:200s]" />
      {/* Rose/pink — upper-right, bridges warm and cool */}
      <div className="absolute -top-[10%] right-[30%] w-[35vw] h-[35vh] rounded-full
        bg-[#EC4899] opacity-[0.06] blur-[140px] will-change-transform
        animate-drift-5 motion-reduce:[animation-duration:200s]" />
    </div>
  );
}
