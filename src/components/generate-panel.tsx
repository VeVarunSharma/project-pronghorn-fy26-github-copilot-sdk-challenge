"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";
import {
  Rocket,
  Loader2,
  ExternalLink,
  Shield,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";

interface StageEvent {
  stage: string;
  message: string;
  progress?: number;
  repoUrl?: string;
  filesCreated?: number;
  filePaths?: string[];
  securityActions?: string[];
  description?: string;
  error?: string;
  issues?: { number: number; title: string; url: string }[];
  issuesCreated?: number;
}

interface GeneratePanelProps {
  appName?: string;
  requirements?: string;
  onAppNameChange?: (name: string) => void;
  onRequirementsChange?: (reqs: string) => void;
  triggerGenerate?: boolean;
  onGenerateTriggered?: () => void;
}

export function GeneratePanel({
  appName: externalAppName,
  requirements: externalRequirements,
  onAppNameChange,
  onRequirementsChange,
  triggerGenerate,
  onGenerateTriggered,
}: GeneratePanelProps) {
  const [internalAppName, setInternalAppName] = useState("");
  const [internalRequirements, setInternalRequirements] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [stages, setStages] = useState<StageEvent[]>([]);
  const [result, setResult] = useState<StageEvent | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const appName = externalAppName ?? internalAppName;
  const requirements = externalRequirements ?? internalRequirements;

  const setAppName = useCallback((val: string) => {
    setInternalAppName(val);
    onAppNameChange?.(val);
  }, [onAppNameChange]);

  const setRequirements = useCallback((val: string) => {
    setInternalRequirements(val);
    onRequirementsChange?.(val);
  }, [onRequirementsChange]);

  useEffect(() => {
    if (externalAppName !== undefined) setInternalAppName(externalAppName);
  }, [externalAppName]);

  useEffect(() => {
    if (externalRequirements !== undefined) setInternalRequirements(externalRequirements);
  }, [externalRequirements]);

  const handleGenerate = useCallback(async () => {
    if (!appName.trim() || !requirements.trim()) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsGenerating(true);
    setStages([]);
    setResult(null);

    try {
      const res = await fetch("/api/pronghorn/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          appName: appName.trim(),
          requirements: requirements.trim(),
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || `Server error: ${res.status}`);
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
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
                const parsed: StageEvent = JSON.parse(data);
                if (
                  parsed.stage === "complete" ||
                  parsed.stage === "error"
                ) {
                  setResult(parsed);
                }
                setStages((prev) => [...prev, parsed]);
              } catch {
                // skip
              }
            }
          }
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setResult({
        stage: "error",
        message: err instanceof Error ? err.message : "Unknown error",
        error: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setIsGenerating(false);
    }
  }, [appName, requirements]);

  useEffect(() => {
    if (triggerGenerate && appName.trim() && requirements.trim() && !isGenerating) {
      onGenerateTriggered?.();
      handleGenerate();
    }
  }, [triggerGenerate, appName, requirements, isGenerating, handleGenerate, onGenerateTriggered]);

  const latestStage = stages[stages.length - 1];

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Rocket className="h-4 w-4" />
            Generate Project
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Application Name
            </label>
            <Input
              value={appName}
              onChange={(e) => setAppName(e.target.value)}
              placeholder="e.g., citizen-service-api"
              disabled={isGenerating}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Requirements
            </label>
            <Textarea
              value={requirements}
              onChange={(e) => setRequirements(e.target.value)}
              placeholder="A Node.js REST API for managing citizen service requests with CRUD operations, JWT authentication, and PostgreSQL..."
              disabled={isGenerating}
              rows={4}
            />
          </div>

          <Button
            onClick={handleGenerate}
            disabled={
              isGenerating || !appName.trim() || !requirements.trim()
            }
            className="w-full"
            size="lg"
          >
            {isGenerating ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Rocket className="h-4 w-4" />
                Generate & Deploy
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Progress */}
      {stages.length > 0 && (
        <Card>
          <CardContent className="pt-4 space-y-3">
            {latestStage?.progress !== undefined && (
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-300"
                  style={{ width: `${latestStage.progress}%` }}
                />
              </div>
            )}
            <div className="space-y-1 max-h-[200px] overflow-y-auto">
              {stages.map((stage, i) => (
                <p
                  key={i}
                  className={`text-xs ${
                    stage.stage === "error"
                      ? "text-destructive"
                      : stage.stage === "complete"
                        ? "text-green-600 dark:text-green-400 font-medium"
                        : "text-muted-foreground"
                  }`}
                >
                  {stage.message}
                </p>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Success */}
      {result?.stage === "complete" && result.repoUrl && (
        <Card className="border-green-200 dark:border-green-800 bg-green-50/50 dark:bg-green-950/20">
          <CardContent className="pt-4 space-y-3">
            <div className="flex items-center gap-2 text-green-700 dark:text-green-400">
              <CheckCircle2 className="h-4 w-4" />
              <span className="text-sm font-semibold">Enterprise Project Scaffolded!</span>
            </div>
            <a
              href={result.repoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-sm text-primary hover:underline break-all"
            >
              <ExternalLink className="h-3 w-3 shrink-0" />
              {result.repoUrl}
            </a>
            <div className="flex gap-2 flex-wrap">
              <Badge variant="success">
                {result.filesCreated} files
              </Badge>
              <Badge variant="success">
                {result.securityActions?.length ?? 0} security policies
              </Badge>
              {(result.issuesCreated ?? 0) > 0 && (
                <Badge variant="success">
                  {result.issuesCreated} issues created
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Created Issues */}
      {(() => {
        const issueStage = stages.find((s) => s.stage === "issues_created" && s.issues);
        if (!issueStage?.issues?.length) return null;
        return (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                📝 Issues Ready for Copilot
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {issueStage.issues.map((issue) => (
                <a
                  key={issue.number}
                  href={issue.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-start gap-2 text-xs hover:bg-muted/50 rounded p-1.5 -mx-1.5 transition-colors"
                >
                  <span className="text-muted-foreground font-mono shrink-0">#{issue.number}</span>
                  <span className="text-primary hover:underline">{issue.title}</span>
                </a>
              ))}
              <p className="text-xs text-muted-foreground pt-1 border-t mt-2">
                💡 Assign these issues to Copilot to implement the features
              </p>
            </CardContent>
          </Card>
        );
      })()}

      {/* Error */}
      {result?.stage === "error" && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 text-destructive">
              <AlertCircle className="h-4 w-4" />
              <span className="text-sm">{result.error}</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Info */}
      <Card className="bg-muted/30">
        <CardContent className="pt-4">
          <div className="flex items-start gap-2">
            <Shield className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <div>
              <p className="text-xs font-medium">
                Blast Radius Isolation
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                All generated repos are created in a sandboxed GitHub
                organization, protecting your 3,400+ production repositories.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
