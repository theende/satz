// Copyright 2026 the Ende authors. MIT license.
export const url = "/feed.xml";

export default ({ site }: { site: string; }) => `<feed title="${site}"/>\n`;
