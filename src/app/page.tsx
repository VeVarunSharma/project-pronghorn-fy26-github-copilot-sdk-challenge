"use client";

import { useState, useCallback, useRef } from "react";
import { ChatWindow, type Message } from "@/components/chat-window";
import { MessageInput } from "@/components/message-input";
import { GeneratePanel } from "@/components/generate-panel";
import { Badge } from "@/components/ui/badge";
import { Github, Shield } from "lucide-react";

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const messagesRef = useRef<Message[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  // Generate panel state (lifted up so chat can populate it)
  const [genAppName, setGenAppName] = useState("");
  const [genRequirements, setGenRequirements] = useState("");
  const [triggerGenerate, setTriggerGenerate] = useState(false);
  const generatePanelRef = useRef<HTMLDivElement>(null);

  const handleGenerateFromChat = useCallback((fullContent: string) => {
    // Extract a meaningful project name from the assistant's response
    let appName = "generated-app";
    const namePatterns = [
      // Match "Government of Alberta Permit & Licensing System" style names
      /(?:Government of Alberta|GovAlta|Alberta)\s+([A-Z][\w&\s-]+(?:System|Portal|API|Service|Platform|App|Application|Tracker|Manager|Hub))/i,
      // Match titles after "architecture for the" or "for the Government of Alberta"
      /(?:architecture for|building|for)\s+(?:the\s+)?(?:Government of Alberta\s+)?([A-Z][\w&\s-]+(?:System|Portal|API|Service|Platform|App|Application|Tracker|Manager|Hub))/i,
      // Match "# ProjectName" markdown headers
      /^#+ (.+(?:System|Portal|API|Service|Platform|App|Application|Tracker|Manager|Hub))/im,
      // Match "Permit & Licensing System" style standalone names
      /([A-Z][\w&]+(?:\s+[A-Z&][\w&]+)*\s+(?:System|Portal|API|Service|Platform|App|Application|Tracker|Manager|Hub))/,
    ];

    for (const pat of namePatterns) {
      const match = fullContent.match(pat);
      if (match) {
        const raw = (match[1] || match[0]).trim();
        // Prefix with "goa-" (Government of Alberta) for the repo name
        appName = "goa-" + raw.toLowerCase()
          .replace(/&/g, "and")
          .replace(/\s+/g, "-")
          .replace(/[^a-z0-9-]/g, "")
          .replace(/-+/g, "-")
          .slice(0, 50);
        break;
      }
    }

    setGenAppName(appName);
    setGenRequirements(fullContent);

    generatePanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    generatePanelRef.current?.classList.add("ring-2", "ring-primary", "ring-offset-2");
    setTimeout(() => {
      generatePanelRef.current?.classList.remove("ring-2", "ring-primary", "ring-offset-2");
    }, 2000);
  }, []);

  const sendMessage = useCallback(async (text: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
    };
    const assistantId = crypto.randomUUID();
    const assistantMsg: Message = {
      id: assistantId,
      role: "assistant",
      content: "",
    };

    messagesRef.current = [...messagesRef.current, userMsg, assistantMsg];
    setMessages([...messagesRef.current]);
    setIsLoading(true);

    const history = messagesRef.current
      .filter(
        (m) =>
          m.id !== assistantId &&
          (m.role === "user" || m.role === "assistant")
      )
      .map((m) => ({ role: m.role, content: m.content }));
    history.pop();

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          history: history.length > 0 ? history : undefined,
        }),
        signal: controller.signal,
      });

      if (!res.ok) throw new Error(`Server error: ${res.status}`);

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let content = "";
      let buffer = "";

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const data = line.slice(6);
              if (data === "[DONE]") continue;
              try {
                const parsed = JSON.parse(data);
                if (parsed.error) throw new Error(parsed.error);
                if (parsed.content) {
                  content += parsed.content;
                  messagesRef.current = messagesRef.current.map((m) =>
                    m.id === assistantId ? { ...m, content } : m
                  );
                  setMessages([...messagesRef.current]);
                }
              } catch (e) {
                if (e instanceof SyntaxError) continue;
                throw e;
              }
            }
          }
        }
      }

      if (!content) {
        messagesRef.current = messagesRef.current.map((m) =>
          m.id === assistantId
            ? { ...m, content: "(empty response)" }
            : m
        );
        setMessages([...messagesRef.current]);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      messagesRef.current = messagesRef.current.map((m) =>
        m.id === assistantId
          ? {
              ...m,
              role: "error" as const,
              content:
                err instanceof Error ? err.message : "Unknown error",
            }
          : m
      );
      setMessages([...messagesRef.current]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 min-h-screen flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            🦌 Pronghorn
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            AI-powered enterprise application generator — built with GitHub
            Copilot SDK
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="gap-1">
            <Shield className="h-3 w-3" />
            Sandbox Isolated
          </Badge>
          <Badge variant="secondary" className="gap-1">
            <Github className="h-3 w-3" />
            Copilot SDK
          </Badge>
        </div>
      </header>

      {/* Main Layout */}
      <div className="flex-1 flex gap-6 min-h-0">
        {/* Chat Panel */}
        <div className="flex-1 flex flex-col border rounded-xl bg-card overflow-hidden shadow-sm">
          <div className="px-4 py-2.5 border-b bg-muted/30 text-xs font-medium text-muted-foreground uppercase tracking-wider">
            💬 Requirements Chat
          </div>
          <ChatWindow
            messages={messages}
            isStreaming={isLoading}
            onGenerateClick={handleGenerateFromChat}
            onSendPreset={sendMessage}
          />
          <MessageInput onSend={sendMessage} disabled={isLoading} />
        </div>

        {/* Generate Panel */}
        <div className="w-[400px] shrink-0 transition-all duration-300 rounded-xl" ref={generatePanelRef}>
          <GeneratePanel
            appName={genAppName}
            requirements={genRequirements}
            onAppNameChange={setGenAppName}
            onRequirementsChange={setGenRequirements}
            triggerGenerate={triggerGenerate}
            onGenerateTriggered={() => setTriggerGenerate(false)}
          />
        </div>
      </div>

      {/* Footer */}
      <footer className="text-center py-4 text-xs text-muted-foreground mt-4">
        Built with the{" "}
        <a
          href="https://github.com/github/copilot-sdk"
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:underline"
        >
          GitHub Copilot SDK
        </a>{" "}
        · GovAlta Enterprise Pattern · Sandbox Org Isolation Architecture
      </footer>
    </div>
  );
}
