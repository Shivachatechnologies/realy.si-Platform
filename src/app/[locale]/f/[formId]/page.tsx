import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PublicLeadForm } from "@/components/marketing/public-form";
import { getT } from "@/i18n/server";
import { getPublicForm } from "@/server/modules/marketing/forms";

export async function generateMetadata({ params }: PageProps<"/[locale]/f/[formId]">): Promise<Metadata> {
  const f = await getPublicForm((await params).formId);
  return { title: f?.title ?? (await getT())("marketing.publicForm.unavailable"), robots: { index: false } };
}

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v.slice(0, 100) : undefined);

/** Public, unauthenticated lead-capture page for a Marketing form. */
export default async function PublicFormPage({ params, searchParams }: PageProps<"/[locale]/f/[formId]">) {
  const { formId } = await params;
  const sp = await searchParams;
  const f = await getPublicForm(formId);
  if (!f) notFound();
  return (
    <main className="mx-auto grid min-h-screen w-full max-w-lg content-center gap-6 px-4 py-10">
      <div className="grid gap-1">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{f.company.name}</p>
        <h1 className="text-xl font-semibold tracking-tight">{f.title}</h1>
        {f.description ? <p className="whitespace-pre-wrap text-muted-foreground">{f.description}</p> : null}
      </div>
      <div className="rounded-lg border bg-surface p-5">
        <PublicLeadForm
          formId={f.id}
          fields={f.fields}
          submitLabel={f.submitLabel}
          successMessage={f.successMessage}
          companyName={f.company.name}
          utm={{ campaign: one(sp.utm_campaign), source: one(sp.utm_source), medium: one(sp.utm_medium) }}
        />
      </div>
    </main>
  );
}
