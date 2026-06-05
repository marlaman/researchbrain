import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Layout } from "./components/Layout";
import { TopicsList } from "./pages/TopicsList";
import { CreateTopic } from "./pages/CreateTopic";
import { TopicDetail } from "./pages/TopicDetail";

export function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<TopicsList />} />
          <Route path="/topics/new" element={<CreateTopic />} />
          <Route path="/topics/:id" element={<TopicDetail />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}
