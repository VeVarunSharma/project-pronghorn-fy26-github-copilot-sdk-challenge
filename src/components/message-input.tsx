"use client";

import { useState, type FormEvent } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Send } from "lucide-react";

interface MessageInputProps {
  onSend: (message: string) => void;
  disabled: boolean;
}

export function MessageInput({ onSend, disabled }: MessageInputProps) {
  const [value, setValue] = useState("");

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setValue("");
  };

  return (
    <form
      className="flex gap-2 p-4 border-t bg-muted/30"
      onSubmit={handleSubmit}
    >
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Describe your application requirements..."
        autoFocus
        disabled={disabled}
        className="flex-1"
      />
      <Button
        type="submit"
        disabled={disabled || !value.trim()}
        size="icon"
        className="shrink-0"
      >
        <Send className="h-4 w-4" />
      </Button>
    </form>
  );
}
