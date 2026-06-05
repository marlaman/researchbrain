interface Props {
  status: string;
  type?: "topic" | "job";
}

export function StatusBadge({ status, type = "topic" }: Props) {
  const cls =
    type === "job"
      ? `badge badge-${status}`
      : `badge badge-${status}`;

  return (
    <span className={cls}>
      <span className="badge-dot" />
      {status}
    </span>
  );
}
