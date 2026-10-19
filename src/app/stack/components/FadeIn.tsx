"use client";
import { motion } from "framer-motion";

/**
 * Wraps a child section with a one-time fade+rise on mount. Stagger is
 * controlled by passing different delay values (in seconds) to siblings.
 */
export function FadeIn({
  children,
  delay = 0,
}: {
  children: React.ReactNode;
  delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}
