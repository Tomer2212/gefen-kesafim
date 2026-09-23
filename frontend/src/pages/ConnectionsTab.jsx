import ConnectionsList from "../components/ConnectionsList";

export default function ConnectionsTab() {
  return (
    <section aria-labelledby="section-connections" className="max-w-2xl">
      <h2 id="section-connections" className="sr-only">חיבורים פעילים</h2>
      <p className="text-slate-500 text-sm mb-6">
        עד 3 חיבורים פעילים בו-זמנית. אם התחברת ממחשב חיצוני (למשל בבית ספר) ושכחת להתנתק, ניתן לנתק אותו כאן מרחוק — הניתוק ייכנס לתוקף תוך פחות מדקה. את "החיבור הראשי" הקבוע קובעים בעלים/מנהל באזור הניהול, וגם רק הם יכולים להסיר אותו.
      </p>
      <ConnectionsList />
    </section>
  );
}
