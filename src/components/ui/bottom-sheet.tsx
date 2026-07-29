"use client";

import { AnimatePresence, motion } from "motion/react";

const SHEET_EASE = [0.16, 1, 0.3, 1] as const;

export function BottomSheet({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          onClick={onClose}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[60] flex items-end bg-[rgba(15,16,20,.42)]"
        >
          <motion.div
            onClick={(e) => e.stopPropagation()}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ duration: 0.28, ease: SHEET_EASE }}
            className="w-full rounded-t-[24px] bg-white px-5 pt-[22px]"
            style={{ paddingBottom: "calc(22px + env(safe-area-inset-bottom, 0px))" }}
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
