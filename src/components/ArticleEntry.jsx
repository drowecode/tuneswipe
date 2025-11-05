import { useState } from "react"

export default function ArticleEntry({ addArticle }) {
  const [title, setTitle] = useState("")
  const [body, setBody] = useState("")
  const [error, setError] = useState(null)

  function submit(e) {
    setError(null)
    e.preventDefault()
    if (!title.trim() || !body.trim()) {
      setError("Both the title and body must be supplied")
    } else {
      addArticle({ title, body })
    }
  }

  return (
    <div>
      <form onSubmit={submit}>
        {error && <p className="error">{error}</p>}
        Title
        <input value={title} onChange={(e) => setTitle(e.target.value)} />
        Body
        <textarea
          rows="8"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        ></textarea>
        <button type="submit">Create</button>
      </form>
    </div>
  )
}
