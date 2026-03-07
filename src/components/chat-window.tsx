"use client";

import { useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Rocket } from "lucide-react";

export interface Message {
  id: string;
  role: "user" | "assistant" | "error";
  content: string;
}

interface ChatWindowProps {
  messages: Message[];
  isStreaming: boolean;
  onGenerateClick?: (requirements: string) => void;
}

const READY_PATTERNS = [
  "ready to generate",
  "head over to",
  "generate project",
  "finalized requirements",
  "requirements summary",
  "here's your finalized",
  "ready! 👍",
  "ready!",
];

function isReadyMessage(content: string): boolean {
  const lower = content.toLowerCase();
  return READY_PATTERNS.some((p) => lower.includes(p));
}

function extractRequirementsSummary(content: string): string {
  const lines = content.split("\n");
  const summaryLines: string[] = [];
  let inQuote = false;

  for (const line of lines) {
    if (line.startsWith('"') && !inQuote) {
      inQuote = true;
      summaryLines.push(line.replace(/^"/, "").replace(/"$/, ""));
      if (line.endsWith('"')) inQuote = false;
      continue;
    }
    if (inQuote) {
      summaryLines.push(line.replace(/"$/, ""));
      if (line.endsWith('"')) inQuote = false;
      continue;
    }
  }

  if (summaryLines.length > 0) return summaryLines.join("\n").trim();

  // Fallback: grab all bold/key lines as a summary
  const keyLines = lines.filter(
    (l) =>
      l.match(/^\*\*/) ||
      l.match(/^- \*\*/) ||
      l.match(/^[A-Z][a-z]+:/) ||
      l.match(/^#+\s/)
  );
  if (keyLines.length > 0) return keyLines.join("\n").trim();

  return content.trim();
}

export function ChatWindow({ messages, isStreaming, onGenerateClick }: ChatWindowProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-8 text-muted-foreground text-sm">
        <div className="text-center space-y-2">
          <p className="text-2xl">🦌</p>
          <p>Describe your application requirements to get started.</p>
          <p className="text-xs opacity-70">
            Try: &quot;I need a Node.js REST API for managing citizen service requests&quot;
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-[400px] max-h-[60vh]">
      {messages.map((msg, i) => {
        const isLast = i === messages.length - 1;
        const streaming = msg.role === "assistant" && isStreaming && isLast;
        const showLoader = streaming && !msg.content;
        const showGenerateBtn =
          msg.role === "assistant" &&
          !isStreaming &&
          msg.content &&
          isReadyMessage(msg.content) &&
          onGenerateClick;

        return (
          <div key={msg.id}>
            <div
              className={cn(
                "max-w-[80%] rounded-xl px-4 py-3 text-sm leading-relaxed",
                msg.role === "user" &&
                  "ml-auto bg-primary text-primary-foreground rounded-br-sm",
                msg.role === "assistant" &&
                  "bg-muted border rounded-bl-sm",
                msg.role === "error" &&
                  "bg-destructive/10 border-destructive/30 border text-destructive",
                streaming && "border-l-2 border-l-primary animate-pulse"
              )}
            >
              {showLoader ? (
                <span className="animate-pulse text-muted-foreground">🦌 Thinking...</span>
              ) : msg.role === "assistant" ? (
                <div className="prose prose-sm dark:prose-invert max-w-none [&_pre]:bg-black/5 [&_pre]:rounded-lg [&_pre]:p-3 [&_code]:text-xs">
                  <ReactMarkdown>{msg.content}</ReactMarkdown>
                </div>
              ) : (
                msg.content
              )}
            </div>
            {showGenerateBtn && (
              <div className="mt-2 ml-0">
                <Button
                  size="lg"
                  className="gap-2 bg-green-600 hover:bg-green-700 text-white shadow-lg animate-in fade-in slide-in-from-bottom-2 duration-300"
                  onClick={() => {
                    const summary = extractRequirementsSummary(msg.content);
                    onGenerateClick!(summary);
                  }}
                >
                  <Rocket className="h-4 w-4" />
                  🚀 Generate & Deploy This Project
                </Button>
              </div>
            )}
          </div>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}
