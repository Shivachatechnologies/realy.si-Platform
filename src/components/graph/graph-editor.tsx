"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Plus, Trash2 } from "lucide-react";
import type { GraphEntityKind, GraphRelation } from "@/generated/prisma/enums";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api-client";
import { ENTITY_KINDS, RELATION_KEYS, RELATIONS, relationAllowed } from "@/server/modules/graph/relations";

interface Entity {
  id: string;
  kind: GraphEntityKind;
  name: string;
  description: string | null;
}
interface Edge {
  id: string;
  fromId: string;
  relation: GraphRelation;
  toId: string;
}

export function GraphEditor({ organizationId, companyId, canManage, entities, edges }: { organizationId: string; companyId: string; canManage: boolean; entities: Entity[]; edges: Edge[] }) {
  const t = useT();
  const router = useRouter();
  const base = `/api/v1/organizations/${organizationId}/companies/${companyId}/graph`;
  const byId = useMemo(() => new Map(entities.map((e) => [e.id, e])), [entities]);
  const [selectedId, setSelectedId] = useState<string | null>(entities[0]?.id ?? null);
  const selected = selectedId ? byId.get(selectedId) : undefined;
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function run(call: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await call();
      router.refresh();
      return true;
    } catch (e) {
      setError(e);
      return false;
    } finally {
      setBusy(false);
    }
  }

  // New entity
  const [kind, setKind] = useState<GraphEntityKind>("PERSON");
  const [name, setName] = useState("");
  async function addEntity(e: FormEvent) {
    e.preventDefault();
    if (await run(() => api(`${base}/entities`, { body: { kind, name } }))) setName("");
  }

  // New relation from the selected entity
  const relationOptions = selected ? RELATION_KEYS.filter((r) => (RELATIONS[r].from as readonly GraphEntityKind[]).includes(selected.kind)) : [];
  const [relation, setRelation] = useState<GraphRelation | "">("");
  const activeRelation = relation && relationOptions.includes(relation) ? relation : relationOptions[0];
  const targets = selected && activeRelation ? entities.filter((x) => x.id !== selected.id && relationAllowed(activeRelation, selected.kind, x.kind)) : [];
  const [targetId, setTargetId] = useState("");
  const activeTarget = targets.some((x) => x.id === targetId) ? targetId : targets[0]?.id;
  async function addEdge(e: FormEvent) {
    e.preventDefault();
    if (!selected || !activeRelation || !activeTarget) return;
    await run(() => api(`${base}/edges`, { body: { fromId: selected.id, relation: activeRelation, toId: activeTarget } }));
  }

  const outgoing = selected ? edges.filter((x) => x.fromId === selected.id) : [];
  const incoming = selected ? edges.filter((x) => x.toId === selected.id) : [];

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
      <Card>
        <CardHeader title={t("graph.entities")} description={t("graph.counts", { entities: entities.length, relations: edges.length })} />
        <CardBody className="grid gap-4">
          {canManage ? (
            <form onSubmit={addEntity} className="grid gap-2 sm:grid-cols-[10rem_minmax(0,1fr)_auto] sm:items-end">
              <Field label={t("graph.kind")} htmlFor="graph-kind">
                <Select id="graph-kind" value={kind} onChange={(e) => setKind(e.target.value as GraphEntityKind)}>
                  {ENTITY_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {t(`graph.kinds.${k}`)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t("graph.name")} htmlFor="graph-name">
                <Input id="graph-name" value={name} maxLength={160} required onChange={(e) => setName(e.target.value)} />
              </Field>
              <Button type="submit" disabled={busy || !name.trim()}>
                <Plus aria-hidden />
                {t("graph.addEntity")}
              </Button>
            </form>
          ) : null}
          {entities.length === 0 ? (
            <p className="text-muted-foreground">{t("graph.empty")}</p>
          ) : (
            <ul className="grid gap-3" aria-label={t("graph.entities")}>
              {ENTITY_KINDS.filter((k) => entities.some((e) => e.kind === k)).map((k) => (
                <li key={k} className="grid gap-1">
                  <h3 className="text-xs font-medium uppercase text-muted-foreground">{t(`graph.kinds.${k}`)}</h3>
                  <div className="flex flex-wrap gap-1.5">
                    {entities
                      .filter((e) => e.kind === k)
                      .map((e) => (
                        <Button key={e.id} type="button" size="sm" variant={e.id === selectedId ? "default" : "secondary"} aria-pressed={e.id === selectedId} onClick={() => setSelectedId(e.id)}>
                          {e.name}
                        </Button>
                      ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        {selected ? (
          <>
            <CardHeader
              title={
                <span className="flex items-center gap-2">
                  {selected.name}
                  <Badge>{t(`graph.kinds.${selected.kind}`)}</Badge>
                </span>
              }
              actions={
                canManage ? (
                  <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => run(() => api(`${base}/entities/${selected.id}`, { method: "DELETE" }))}>
                    <Trash2 aria-hidden />
                    {t("graph.deleteEntity")}
                  </Button>
                ) : null
              }
            />
            <CardBody className="grid gap-4">
              <section className="grid gap-2" aria-label={t("graph.relations")}>
                <h3 className="text-sm font-medium">{t("graph.relations")}</h3>
                {outgoing.length + incoming.length === 0 ? <p className="text-muted-foreground">{t("graph.noRelations")}</p> : null}
                <ul className="grid gap-1.5">
                  {[...outgoing, ...incoming].map((edge) => {
                    const from = byId.get(edge.fromId);
                    const to = byId.get(edge.toId);
                    return (
                      <li key={edge.id} className="flex items-center gap-2 rounded-md border px-3 py-1.5">
                        <span className={edge.fromId === selected.id ? "font-medium" : ""}>{from?.name}</span>
                        <ArrowRight aria-hidden className="size-3.5 text-muted-foreground rtl:rotate-180" />
                        <Badge tone="neutral">{t(`graph.relationLabels.${edge.relation}`)}</Badge>
                        <ArrowRight aria-hidden className="size-3.5 text-muted-foreground rtl:rotate-180" />
                        <button type="button" className={edge.toId === selected.id ? "font-medium" : "hover:underline"} onClick={() => setSelectedId(edge.fromId === selected.id ? edge.toId : edge.fromId)}>
                          {to?.name}
                        </button>
                        {canManage ? (
                          <Button type="button" size="icon" variant="ghost" className="ms-auto size-7" aria-label={t("graph.removeRelation")} disabled={busy} onClick={() => run(() => api(`${base}/edges/${edge.id}`, { method: "DELETE" }))}>
                            <Trash2 aria-hidden />
                          </Button>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </section>
              {canManage && relationOptions.length > 0 ? (
                <form onSubmit={addEdge} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
                  <Field label={t("graph.relation")} htmlFor="graph-relation">
                    <Select id="graph-relation" value={activeRelation} onChange={(e) => setRelation(e.target.value as GraphRelation)}>
                      {relationOptions.map((r) => (
                        <option key={r} value={r}>
                          {t(`graph.relationLabels.${r}`)}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label={t("graph.target")} htmlFor="graph-target">
                    <Select id="graph-target" value={activeTarget ?? ""} disabled={targets.length === 0} onChange={(e) => setTargetId(e.target.value)}>
                      {targets.length === 0 ? <option value="">{t("graph.noTargets")}</option> : null}
                      {targets.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.name} · {t(`graph.kinds.${x.kind}`)}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Button type="submit" disabled={busy || !activeTarget}>
                    <Plus aria-hidden />
                    {t("graph.addRelation")}
                  </Button>
                </form>
              ) : null}
            </CardBody>
          </>
        ) : (
          <CardBody>
            <p className="text-muted-foreground">{t("graph.selectHint")}</p>
          </CardBody>
        )}
      </Card>
      <div className="lg:col-span-2">
        <FormError error={error} />
      </div>
    </div>
  );
}
