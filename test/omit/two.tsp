import "@typespec/http";

using Http;

/**
 * **Two services in one program, only one of which this project serves.**
 *
 * One program is what makes a shared vocabulary shared, so a surface a project does not serve yet
 * still belongs in the compile: its types and validators are wanted, its server is not. Without a way
 * to say so, the emitter wrote an `app.gen.ts` for it that the project keeps honest with probe tests
 * and never mounts.
 */
@service(#{ title: "Served" })
namespace Served {
  model A {
    id: string;
  }

  @route("/a")
  @get
  op a(): A;
}

@service(#{ title: "Unserved" })
namespace Unserved {
  model B {
    id: string;
  }

  @route("/b")
  @get
  op b(): B;
}
