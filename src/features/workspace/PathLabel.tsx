import { fileName, folderPrefix } from "@/shared/lib/paths";

type Props = {
  path: string;
  dirClassName: string;
};

// The folders shown grey and the name white, so the eye finds the file
export function PathLabel({ path, dirClassName }: Props) {
  const folder = folderPrefix(path);
  return (
    <>
      {folder && <span className={dirClassName}>{folder}</span>}
      {fileName(path)}
    </>
  );
}
