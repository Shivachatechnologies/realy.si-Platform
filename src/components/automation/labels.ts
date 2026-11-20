/** i18n key of a domain event type's label (dots are not allowed inside message keys). */
export const eventLabelKey = (type: string) => `workflows.events.${type.replaceAll(".", "_")}`;
