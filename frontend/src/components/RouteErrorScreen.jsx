import { useRouteError } from "react-router-dom";

// Router-level fallback for a render error, instead of React Router's raw developer screen.
export default function RouteErrorScreen() {
  const error = useRouteError();
  console.error("[route error]", error);
  return (
    <div dir="rtl" className="min-h-screen flex items-center justify-center bg-scene p-4">
      <div role="alert" className="max-w-md w-full rounded-2xl bg-white shadow p-6 text-center space-y-4">
        <h1 className="text-lg font-semibold text-slate-800">משהו השתבש בטעינת העמוד</h1>
        <p className="text-sm text-slate-600">
          ייתכן שהמערכת עודכנה בזמן שהעמוד היה פתוח. רענון העמוד יטען את הגרסה העדכנית.
        </p>
        <button type="button" onClick={() => window.location.reload()}
                className="rounded-lg bg-blue-600 text-white font-semibold px-4 py-2 hover:bg-blue-700">
          רענן את העמוד
        </button>
      </div>
    </div>
  );
}
