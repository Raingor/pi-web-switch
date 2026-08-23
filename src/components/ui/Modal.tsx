import { X } from "lucide-react";
import type { ReactNode } from "react";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  size?: "sm" | "md" | "lg";
}

export function Modal({ open, onClose, title, children, size = "md" }: ModalProps) {
  if (!open) return null;

  const sizeClasses = { sm: "max-w-md", md: "max-w-lg", lg: "max-w-2xl" };

  return (
    <div className="modal-shell">
      <div className="modal-backdrop" onClick={onClose} />
      <div className={`tech-modal ${sizeClasses[size]}`}>
        <div className="modal-header">
          <div>
            <span className="modal-kicker">COMMAND DIALOG</span>
            <h2>{title}</h2>
          </div>
          <button onClick={onClose} className="modal-close" aria-label="Close dialog">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="modal-content">{children}</div>
      </div>
    </div>
  );
}
