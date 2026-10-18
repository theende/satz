import { Head } from "fresh/runtime";
import { define } from "../utils.ts";
import data from "./api/data.json" with { type: "json" };
import { LinkButton } from "../components/LinkButton.tsx";

export default define.page(function Home() {
  return (
    <>
      <Head>
        <title>Dinosaur Encyclopedia</title>
      </Head>
      <main>
        <h1>🦕 Welcome to the Dinosaur Encyclopedia</h1>
        <p>Click on a dinosaur below to learn more.</p>
        <div class="dinosaur-list">
          {data.map((dinosaur: { name: string; description: string }) => (
            <LinkButton
              href={`/dinosaurs/${dinosaur.name.toLowerCase()}`}
              class="btn-primary"
            >
              {dinosaur.name}
            </LinkButton>
          ))}
        </div>
      </main>
    </>
  );
});
