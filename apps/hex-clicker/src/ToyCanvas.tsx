import { useEffect, useRef, type MutableRefObject } from "react";
import { toyPathAt } from "@escape-cats/shared";

/**
 * Full-screen overlay of wandering mouse toys. Positions are a pure
 * function of (room seed, toy index, server-synced time), so all four
 * phones show the exact same pattern with zero network traffic.
 * The letter-stroke reveal lives behind toyPathAt in the shared package.
 */
export function ToyCanvas({
  seed,
  toyCount,
  clockOffset,
}: {
  seed: number;
  toyCount: number;
  clockOffset: MutableRefObject<number>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef({ seed, toyCount });
  stateRef.current = { seed, toyCount };

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    let raf = 0;

    const resize = () => {
      canvas.width = canvas.clientWidth * devicePixelRatio;
      canvas.height = canvas.clientHeight * devicePixelRatio;
    };
    resize();
    addEventListener("resize", resize);

    const draw = () => {
      const { seed, toyCount } = stateRef.current;
      const now = Date.now() + clockOffset.current;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.font = `${24 * devicePixelRatio}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (let i = 0; i < toyCount; i++) {
        const p = toyPathAt(seed, i, now);
        ctx.fillText("🐭", p.x * canvas.width, p.y * canvas.height);
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      removeEventListener("resize", resize);
    };
  }, [clockOffset]);

  return <canvas ref={canvasRef} className="toy-canvas" />;
}
