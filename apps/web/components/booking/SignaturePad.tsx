"use client";

import React, {
  forwardRef,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { css } from "./css";

export type SignaturePadHandle = { clear: () => void };

type Props = {
  width: number;
  height: number;
  placeholder: string;
  /** Stretch the canvas to the container width (mobile). */
  fullWidth?: boolean;
  onEmptyChange?: (empty: boolean) => void;
};

/**
 * Mouse/touch signature capture on a <canvas>, ported from the prototype.
 * Pointer coordinates are scaled by the canvas backing-store / display ratio
 * so drawing stays accurate even when the canvas is stretched (mobile).
 */
export const SignaturePad = forwardRef<SignaturePadHandle, Props>(
  function SignaturePad(
    { width, height, placeholder, fullWidth, onEmptyChange },
    ref,
  ) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const drawing = useRef(false);
    const last = useRef<[number, number]>([0, 0]);
    const [empty, setEmpty] = useState(true);

    useImperativeHandle(ref, () => ({
      clear() {
        const c = canvasRef.current;
        if (c) c.getContext("2d")?.clearRect(0, 0, c.width, c.height);
        setEmpty(true);
        onEmptyChange?.(true);
      },
    }));

    const pos = (e: React.PointerEvent<HTMLCanvasElement>): [number, number] => {
      const c = canvasRef.current!;
      const r = c.getBoundingClientRect();
      return [
        ((e.clientX - r.left) * c.width) / r.width,
        ((e.clientY - r.top) * c.height) / r.height,
      ];
    };

    const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
      const c = canvasRef.current;
      if (!c) return;
      c.setPointerCapture?.(e.pointerId);
      drawing.current = true;
      last.current = pos(e);
      if (empty) {
        setEmpty(false);
        onEmptyChange?.(false);
      }
    };

    const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
      const c = canvasRef.current;
      if (!drawing.current || !c) return;
      const ctx = c.getContext("2d");
      if (!ctx) return;
      const p = pos(e);
      ctx.strokeStyle = "#1A1B1A";
      ctx.lineWidth = 2.2;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(last.current[0], last.current[1]);
      ctx.lineTo(p[0], p[1]);
      ctx.stroke();
      last.current = p;
    };

    const up = () => {
      drawing.current = false;
    };

    return (
      <div
        style={css(
          `position:relative;background:#FFF;border:1px solid rgba(0,0,0,.12);border-radius:13px;overflow:hidden;${
            fullWidth ? "width:100%;" : `width:${width}px;`
          }max-width:100%`,
        )}
      >
        <canvas
          ref={canvasRef}
          width={width}
          height={height}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerLeave={up}
          style={{
            display: "block",
            width: fullWidth ? "100%" : width,
            height,
            touchAction: "none",
            cursor: "crosshair",
          }}
        />
        {empty && (
          <div
            style={css(
              "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;font:400 14px 'Hanken Grotesk';color:#C7C6C1",
            )}
          >
            {placeholder}
          </div>
        )}
      </div>
    );
  },
);
