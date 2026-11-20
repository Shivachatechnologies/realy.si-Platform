import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { formatDate } from "@/i18n/format";
import type { Translate } from "@/i18n/translate";

export interface DocumentRow {
  id: string;
  title: string;
  filename: string | null;
  mimeType: string;
  status: "PROCESSING" | "READY" | "FAILED";
  passages: number;
  tags: string[];
  sourceType: string | null;
  department: { id: string; name: string } | null;
  createdAt: Date;
}

/** Company Brain documents as a table (server component). */
export function DocumentTable({ rows, t, locale, timeZone }: { rows: DocumentRow[]; t: Translate; locale: string; timeZone: string }) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <THead>
          <Tr>
            <Th>{t("brain.columns.title")}</Th>
            <Th>{t("brain.department")}</Th>
            <Th>{t("brain.columns.source")}</Th>
            <Th>{t("brain.columns.passages")}</Th>
            <Th>{t("brain.columns.status")}</Th>
            <Th>{t("brain.columns.added")}</Th>
          </Tr>
        </THead>
        <TBody>
          {rows.map((d) => (
            <Tr key={d.id}>
              <Td className="font-medium">
                <Link className="hover:underline" href={`/${locale}/brain/${d.id}`}>
                  {d.title}
                </Link>
                {d.filename ? <div className="text-xs font-normal text-muted-foreground">{d.filename}</div> : null}
                {d.tags.length ? (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {d.tags.slice(0, 4).map((tag) => (
                      <Link key={tag} href={`/${locale}/documents?tag=${encodeURIComponent(tag)}`} className="text-xs font-normal text-muted-foreground hover:underline">
                        #{tag}
                      </Link>
                    ))}
                  </div>
                ) : null}
              </Td>
              <Td className="text-muted-foreground">{d.department?.name ?? "—"}</Td>
              <Td>{d.sourceType ? <Badge tone="accent">{t(`brain.sources.${d.sourceType}`)}</Badge> : <span className="font-mono text-xs">{d.mimeType}</span>}</Td>
              <Td className="tabular">{d.passages}</Td>
              <Td>
                <Badge tone={d.status === "READY" ? "success" : d.status === "FAILED" ? "danger" : "warning"}>{t(`brain.status.${d.status}`)}</Badge>
              </Td>
              <Td className="whitespace-nowrap text-muted-foreground">{formatDate(d.createdAt, locale, timeZone)}</Td>
            </Tr>
          ))}
        </TBody>
      </Table>
    </div>
  );
}
