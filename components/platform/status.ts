/** Billing status chips for the owner console. */
export const STATUS_CHIP: Record<string, { label: string; cls: string }> = {
  trial: { label: "Trial", cls: "bg-[#EAF1F9] text-[#1D4B80]" },
  active: { label: "Active", cls: "bg-[#E8F4EC] text-[#155E34]" },
  grace: { label: "Payment due", cls: "bg-[#FDF1E6] text-[#8A430B]" },
  lapsed: { label: "Lapsed", cls: "bg-[#FBEAE9] text-[#A1271F]" },
  suspended: { label: "Suspended", cls: "bg-ink text-white" },
};
