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
  "finalized requirements",
  "requirements summary",
  "here's your finalized",
  "here are the finalized",
  "let's proceed",
  "ready to proceed",
  "shall i generate",
  "we can generate",
  "proceed to generate",
];

function isReadyMessage(content: string, messageIndex: number, totalMessages: number): boolean {
  // Don't show the button on the first assistant response — too early
  // Require at least 3 messages (user, assistant, user, assistant = index 3+)
  if (messageIndex < 3) return false;

  const lower = content.toLowerCase();
  return READY_PATTERNS.some((p) => lower.includes(p));
}

function extractAppName(content: string): string {
  // Try to find a descriptive app name from the content
  const patterns = [
    /(?:application|app|project|service|api)[\s:]+["']?([a-zA-Z][\w\s-]+(?:API|App|Service|Portal|System))/i,
    /(?:citizen|service|request|management)[\w\s-]*(?:API|App|Service|Portal|System)/i,
  ];
  for (const pat of patterns) {
    const match = content.match(pat);
    if (match) {
      const name = (match[1] || match[0]).trim();
      return name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").slice(0, 40);
    }
  }
  return "generated-app";
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
          isReadyMessage(msg.content, i, messages.length) &&
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
                    // Pass the full message content — the Copilot SDK understands it all
                    onGenerateClick!(msg.content);
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
