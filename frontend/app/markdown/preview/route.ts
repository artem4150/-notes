import rehypePrettyCode from "rehype-pretty-code";
import rehypeSanitize from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";

export const runtime = "nodejs";

type PreviewPayload = {
  markdown?: string;
  theme?: "light" | "dark";
};

export async function POST(request: Request) {
  const payload = (await request.json()) as PreviewPayload;

  const markdown = payload.markdown ?? "";
  const theme = payload.theme === "dark" ? "github-dark" : "github-light";

  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype)
    .use(rehypeSanitize)
    .use(rehypePrettyCode, {
      theme,
      keepBackground: false,
      onVisitLine(node: { children: Array<unknown> }) {
        if (node.children.length === 0) {
          node.children = [{ type: "text", value: " " }];
        }
      },
    })
    .use(rehypeStringify)
    .process(markdown);

  return Response.json({ html: String(file.value) });
}