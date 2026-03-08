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
  onSendPreset?: (prompt: string) => void;
}

const PRESET_PROMPTS = [
  {
    emoji: "📋",
    title: "Citizen Service Request API",
    description: "REST API for citizens to submit, track, and manage service requests to municipal departments",
    prompt:
      "I need a Node.js REST API for managing citizen service requests for the Government of Alberta. Citizens should be able to submit requests (e.g., road repair, park maintenance, permit applications), track status, and receive notifications. Government staff should be able to assign, prioritize, and resolve requests. Include role-based access with Azure Entra ID, Azure SQL for data, and Azure Service Bus for async notifications.",
  },
  {
    emoji: "📊",
    title: "FOIP Request Tracker",
    description: "Freedom of Information & Privacy request management portal with compliance tracking",
    prompt:
      "I need a web application to manage Freedom of Information and Protection of Privacy (FOIP) requests for the Government of Alberta. It should track request intake, assignment to analysts, document collection, redaction workflow, approval chain, and response deadlines (30-day statutory requirement). Include audit logging, Azure Blob Storage for document management, role-based access via Azure Entra ID, and a dashboard showing compliance metrics and SLA adherence.",
  },
  {
    emoji: "🏗️",
    title: "Permit & Licensing Portal",
    description: "Digital portal for businesses to apply for and manage government permits and licenses",
    prompt:
      "I need a full-stack application for the Government of Alberta's permit and licensing system. Businesses should be able to apply for permits online, upload supporting documents, pay fees, and track application status. Government reviewers need a workflow to review, approve/reject, and issue permits. Include Azure Cosmos DB for flexible document storage, Azure Blob Storage for file uploads, payment integration hooks, and automated email notifications via Azure Communication Services.",
  },
  {
    emoji: "🔔",
    title: "Public Alert & Notification System",
    description: "Multi-channel emergency and public notification platform for Alberta communities",
    prompt:
      "I need a public alert and notification system for the Government of Alberta that can send emergency alerts and public notices via multiple channels (email, SMS, push notifications). Administrators should be able to create, target (by region/topic), schedule, and send alerts. Include subscriber management, delivery tracking, Azure Service Bus for reliable message delivery, Azure Cosmos DB for subscriber data, and a public-facing subscription portal for citizens.",
  },
];

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
  "generate project",
  "generate & deploy",
  "head to the",
  "head over to",
  "next steps",
  "when you're ready",
  "want me to help refine",
  "recommended architecture",
  "key features breakdown",
];

function isReadyMessage(content: string, messageIndex: number, _totalMessages: number): boolean {
  // For preset prompts, the first assistant response (index 1) is already comprehensive
  if (messageIndex < 1) return false;
  // Must have meaningful content (at least 500 chars suggests a full architecture response)
  if (content.length < 500) return false;

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

export function ChatWindow({ messages, isStreaming, onGenerateClick, onSendPreset }: ChatWindowProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto p-4">
        <div className="text-center space-y-4 mb-6 pt-4">
          <p className="text-3xl">🦌</p>
          <div>
            <p className="text-sm text-muted-foreground">Describe your application requirements to get started,</p>
            <p className="text-sm text-muted-foreground">or pick a template below.</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {PRESET_PROMPTS.map((preset) => (
            <button
              key={preset.title}
              onClick={() => onSendPreset?.(preset.prompt)}
              className="group text-left border rounded-lg p-3 hover:border-primary hover:bg-primary/5 transition-all duration-200 cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1"
            >
              <div className="flex items-start gap-2">
                <span className="text-lg shrink-0 mt-0.5">{preset.emoji}</span>
                <div className="min-w-0">
                  <p className="text-sm font-medium group-hover:text-primary transition-colors leading-tight">
                    {preset.title}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2 leading-relaxed">
                    {preset.description}
                  </p>
                </div>
              </div>
            </button>
          ))}
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
