import ReactMarkdown from "react-markdown";

export default function ChatMessage({ role, content }) {
  const isUser = role === "user";
  return (
    <div className={`flex ${isUser ? "justify-start" : "justify-end"}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
          isUser
            ? "bg-slate-100 text-slate-800"
            : "bg-blue-50 text-slate-800"
        }`}
      >
        {isUser ? (
          <span className="whitespace-pre-wrap">{content}</span>
        ) : (
          <div className="prose-chat">
            <ReactMarkdown>{content}</ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}
