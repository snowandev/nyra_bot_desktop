type Props = {
  domain: string;
  large?: boolean;
};

// Websites are shown by the first letter of their domain: the app never loads images from the internet
export function DomainInitial({ domain, large = false }: Props) {
  return (
    <span className={`domain-initial ${large ? "large" : ""}`} aria-hidden="true">
      {domain.charAt(0)}
    </span>
  );
}
