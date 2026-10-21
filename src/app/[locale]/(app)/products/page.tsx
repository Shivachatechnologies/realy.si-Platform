import type { Metadata } from "next";
import { EntityKindPage } from "@/components/graph/entity-kind-page";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("modules.products.title") };
}

export default function Page() {
  return <EntityKindPage module="products" kinds={["PRODUCT"]} />;
}
