"use client";

import { Bot, RotateCcw, Send, X } from "lucide-react";
import { FormEvent, Fragment, ReactNode, useEffect, useRef, useState } from "react";
import {
  ChatMessage,
  ChatVisorContext,
  generateChatbotReply,
  getInitialChatMessage,
} from "@/lib/astronomy/chatbot-engine";

interface AstronomyChatbotProps {
  context: ChatVisorContext;
}

function renderInlineFormatting(text: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g);
  return parts.map((part, idx) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return (
        <strong key={idx} className="font-semibold">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      return (
        <em key={idx} className="italic">
          {part.slice(1, -1)}
        </em>
      );
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return (
        <code
          key={idx}
          className="rounded bg-black/[.07] px-1 py-0.5 font-mono text-[11px] dark:bg-white/[.12]"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    return <Fragment key={idx}>{part}</Fragment>;
  });
}

function renderFormattedMessage(content: string) {
  const blocks = content.split(/\n{2,}/);
  return (
    <div className="space-y-2 leading-relaxed">
      {blocks.map((block, bIdx) => {
        const lines = block.split("\n");
        return (
          <div key={bIdx} className="space-y-1">
            {lines.map((line, lIdx) => (
              <p key={lIdx}>{renderInlineFormatting(line)}</p>
            ))}
          </div>
        );
      })}
    </div>
  );
}

export default function AstronomyChatbot({ context }: AstronomyChatbotProps) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>(() => [
    getInitialChatMessage(context),
  ]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, open]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  function sendQuestion(questionText: string) {
    const trimmed = questionText.trim();
    if (!trimmed) return;

    const reply = generateChatbotReply(trimmed, context);
    setMessages((prev) => [
      ...prev,
      {
        id: `u-${prev.length}`,
        role: "user",
        content: trimmed,
      },
      {
        id: `a-${prev.length + 1}`,
        role: "assistant",
        content: reply.text,
        suggestions: reply.suggestions,
      },
    ]);
    setInput("");
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    sendQuestion(input);
  }

  function handleReset() {
    setMessages([getInitialChatMessage(context)]);
  }

  const contextTag = context.lastSolvedImage
    ? context.lastSolvedImage.fileName
    : context.activeTarget?.name ?? "Región personalizada";

  return (
    <div className="relative flex flex-col items-end">
      {open && (
        <section
          aria-label="Asistente astronómico"
          className="mb-3 flex max-h-[min(500px,calc(100vh-9.5rem))] w-[calc(100vw-2.5rem)] flex-col overflow-hidden rounded-2xl border border-black/[.12] bg-background text-foreground shadow-2xl dark:border-white/[.18] sm:w-96"
        >
          {/* Cabecera */}
          <div className="flex items-center justify-between gap-2 border-b border-black/[.08] px-3.5 py-2.5 dark:border-white/[.145]">
            <div className="flex min-w-0 items-center gap-2">
              <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-foreground text-background">
                <Bot className="h-3.5 w-3.5" />
              </span>
              <div className="min-w-0">
                <h2 className="truncate text-xs font-semibold">
                  Guía Astronómico
                </h2>
                <p className="truncate text-[10px] text-foreground/60">
                  {contextTag}
                </p>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={handleReset}
                title="Reiniciar conversación"
                aria-label="Reiniciar conversación"
                className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border border-black/[.08] transition-colors hover:bg-[#f2f2f2] dark:border-white/[.145] dark:hover:bg-[#1a1a1a]"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                title="Cerrar guía"
                aria-label="Cerrar guía"
                className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border border-black/[.08] transition-colors hover:bg-[#f2f2f2] dark:border-white/[.145] dark:hover:bg-[#1a1a1a]"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Historial de mensajes */}
          <div
            ref={scrollRef}
            className="custom-select-scroll flex-1 space-y-3 overflow-y-auto p-3"
          >
            {messages.map((msg, idx) => {
              const isLastBot =
                msg.role === "assistant" && idx === messages.length - 1;
              return (
                <div
                  key={msg.id}
                  className={`flex flex-col ${
                    msg.role === "user" ? "items-end" : "items-start"
                  }`}
                >
                  <div
                    className={`max-w-[88%] rounded-2xl px-3 py-2 text-xs ${
                      msg.role === "user"
                        ? "bg-foreground text-background"
                        : "border border-black/[.08] bg-black/[.03] text-foreground dark:border-white/[.145] dark:bg-white/[.05]"
                    }`}
                  >
                    {msg.role === "user"
                      ? msg.content
                      : renderFormattedMessage(msg.content)}
                  </div>

                  {isLastBot && msg.suggestions && msg.suggestions.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {msg.suggestions.map((suggestion) => (
                        <button
                          key={suggestion}
                          type="button"
                          onClick={() => sendQuestion(suggestion)}
                          className="cursor-pointer rounded-full border border-black/[.1] bg-background px-2.5 py-1 text-left text-[11px] font-medium transition-colors hover:bg-[#f2f2f2] dark:border-white/[.16] dark:hover:bg-[#1a1a1a]"
                        >
                          {suggestion}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Entrada de texto */}
          <form
            onSubmit={handleSubmit}
            className="flex items-center gap-2 border-t border-black/[.08] p-2.5 dark:border-white/[.145]"
          >
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Pregunta qué significa algo…"
              className="h-9 min-w-0 flex-1 rounded-full border border-black/[.08] bg-background px-3.5 text-xs text-foreground placeholder:text-foreground/50 focus:outline-none focus:ring-2 focus:ring-foreground/20 dark:border-white/[.145]"
            />
            <button
              type="submit"
              disabled={!input.trim()}
              aria-label="Enviar pregunta"
              className="inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full bg-foreground text-background transition-colors hover:bg-[#383838] disabled:opacity-40 dark:hover:bg-[#ccc]"
            >
              <Send className="h-3.5 w-3.5" />
            </button>
          </form>
        </section>
      )}

      {/* Botón flotante para abrir/cerrar el chatbot */}
      <button
        type="button"
        onClick={() => {
          setOpen((prev) => !prev);
          window.setTimeout(() => inputRef.current?.focus(), 60);
        }}
        aria-expanded={open}
        aria-label={open ? "Cerrar guía astronómico" : "Abrir guía astronómico"}
        title="¿No entiendes un concepto? Pregunta al guía IA"
        className={`inline-flex h-12 w-12 cursor-pointer items-center justify-center rounded-full border border-black/[.14] shadow-xl backdrop-blur-md transition-colors focus:outline-none focus:ring-2 focus:ring-foreground/20 dark:border-white/[.22] ${
          open
            ? "bg-foreground text-background hover:bg-[#383838] dark:hover:bg-[#ccc]"
            : "bg-background/95 text-foreground hover:bg-[#f2f2f2] dark:hover:bg-[#1a1a1a]"
        }`}
      >
        {open ? <X className="h-5 w-5" /> : <Bot className="h-5 w-5" />}
      </button>
    </div>
  );
}
