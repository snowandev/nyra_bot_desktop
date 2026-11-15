type Props = {
  // 0 preparing, 1 downloading, 2 verifying, 3 writing
  current: number;
};

// Four diamonds that mark which of Ollama's steps a download is in
export function DownloadSteps({ current }: Props) {
  return (
    <span className="download-steps" aria-hidden="true">
      {[0, 1, 2, 3].map((step) => (
        <i key={step} className={step < current ? "done" : step === current ? "current" : undefined} />
      ))}
    </span>
  );
}
