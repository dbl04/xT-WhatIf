"use strict";
"use client";

import React from "react";
import { Button, ModalShell } from "@/components/ui/primitives";
import { useI18n } from "@/lib/i18n";

interface DemoGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const STEPS = [1, 2, 3, 4, 5] as const;

export const DemoGuideModal: React.FC<DemoGuideModalProps> = ({ isOpen, onClose }) => {
  const { t } = useI18n();
  if (!isOpen) return null;

  return (
    <ModalShell
      kicker={t("guide.kicker")}
      title={t("guide.title")}
      description={t("guide.desc")}
      onClose={onClose}
      className="max-w-2xl"
      footer={
        <>
          <span className="font-mono text-[10px] uppercase tracking-wider text-fg-subtle">
            {t("guide.footer")}
          </span>
          <Button variant="primary" onClick={onClose}>
            {t("guide.start")}
          </Button>
        </>
      }
    >
      <ol className="divide-y divide-line">
        {STEPS.map((step, idx) => (
          <li key={step} className="flex gap-5 px-5 py-4">
            <span className="w-8 shrink-0 font-display text-[32px] font-bold leading-none tabular-nums text-fg-subtle">
              {String(idx + 1).padStart(2, "0")}
            </span>
            <div className="min-w-0">
              <h3 className="font-display text-lg font-bold uppercase leading-tight tracking-wide text-fg">
                {t(`guide.step${step}.title`)}
              </h3>
              <p className="mt-1 text-[13px] leading-relaxed text-fg-muted">{t(`guide.step${step}.desc`)}</p>
            </div>
          </li>
        ))}
      </ol>
    </ModalShell>
  );
};

export default DemoGuideModal;
