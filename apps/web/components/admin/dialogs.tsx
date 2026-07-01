"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type ConfirmOpts = {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
};

type PromptOpts = {
  title: string;
  description?: string;
  label?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
};

type Ctx = {
  confirm: (o: ConfirmOpts) => Promise<boolean>;
  prompt: (o: PromptOpts) => Promise<string | null>;
};

const DialogCtx = createContext<Ctx | null>(null);

export function useDialogs(): Ctx {
  const ctx = useContext(DialogCtx);
  if (!ctx) throw new Error("useDialogs doit être utilisé dans <DialogProvider>");
  return ctx;
}
export const useConfirm = () => useDialogs().confirm;
export const usePrompt = () => useDialogs().prompt;

type State =
  | { kind: "none" }
  | { kind: "confirm"; opts: ConfirmOpts; resolve: (b: boolean) => void }
  | { kind: "prompt"; opts: PromptOpts; resolve: (s: string | null) => void };

export function DialogProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ kind: "none" });
  const [value, setValue] = useState("");

  const confirm = useCallback(
    (opts: ConfirmOpts) =>
      new Promise<boolean>((resolve) => setState({ kind: "confirm", opts, resolve })),
    [],
  );
  const prompt = useCallback(
    (opts: PromptOpts) =>
      new Promise<string | null>((resolve) => {
        setValue(opts.defaultValue ?? "");
        setState({ kind: "prompt", opts, resolve });
      }),
    [],
  );

  const cancel = () => {
    if (state.kind === "confirm") state.resolve(false);
    if (state.kind === "prompt") state.resolve(null);
    setState({ kind: "none" });
  };
  const accept = () => {
    if (state.kind === "confirm") state.resolve(true);
    if (state.kind === "prompt") state.resolve(value);
    setState({ kind: "none" });
  };

  return (
    <DialogCtx.Provider value={{ confirm, prompt }}>
      {children}
      {state.kind !== "none" && (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-4"
          onClick={cancel}
        >
          <div
            className="w-full max-w-sm rounded-lg border bg-background p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-semibold">{state.opts.title}</h2>
            {state.opts.description && (
              <p className="mt-1.5 text-sm text-muted-foreground whitespace-pre-line">
                {state.opts.description}
              </p>
            )}
            {state.kind === "prompt" && (
              <div className="mt-3 space-y-1.5">
                {state.opts.label && (
                  <label className="text-xs text-muted-foreground">{state.opts.label}</label>
                )}
                <Input
                  autoFocus
                  value={value}
                  placeholder={state.opts.placeholder}
                  onChange={(e) => setValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") accept();
                    if (e.key === "Escape") cancel();
                  }}
                />
              </div>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={cancel}>
                {state.opts.cancelLabel ?? "Annuler"}
              </Button>
              <Button
                size="sm"
                variant={state.kind === "confirm" && state.opts.danger ? "destructive" : "default"}
                onClick={accept}
              >
                {state.kind === "prompt"
                  ? (state.opts.confirmLabel ?? "Valider")
                  : (state.opts.confirmLabel ?? "Confirmer")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </DialogCtx.Provider>
  );
}
