from unittest.mock import MagicMock, patch
from fastapi.testclient import TestClient
from backend.app.main import create_app


def test_smartboard_config():
    db = MagicMock()
    app = create_app(db=db, storage=MagicMock(), token_verifier=MagicMock(), ai_adapter=MagicMock(), rag=MagicMock(), run_worker=False)
    client = TestClient(app)
    r = client.get("/api/v1/smartboard/config")
    assert r.status_code == 200
    assert "status" in r.json()


def test_smartboard_missing_key_returns_503():
    db = MagicMock()
    app = create_app(db=db, storage=MagicMock(), token_verifier=MagicMock(), ai_adapter=MagicMock(), rag=MagicMock(), run_worker=False)
    client = TestClient(app)
    with patch("backend.app.routers.smartboard._get_gemini_key", return_value=None):
        r_sim = client.post("/api/v1/smartboard/generate-simulation", json={"prompt": "test"})
        assert r_sim.status_code == 503
        r_vec = client.post("/api/v1/smartboard/generate-vector", json={"prompt": "test"})
        assert r_vec.status_code == 503
        r_chat = client.post("/api/v1/smartboard/chat", json={"messages": [{"role": "user", "text": "hi"}]})
        assert r_chat.status_code == 503
        r_img = client.post("/api/v1/smartboard/generate-image", json={"prompt": "test"})
        assert r_img.status_code == 503


def test_smartboard_generate_vector_mocked():
    db = MagicMock()
    app = create_app(db=db, storage=MagicMock(), token_verifier=MagicMock(), ai_adapter=MagicMock(), rag=MagicMock(), run_worker=False)
    client = TestClient(app)
    with patch("backend.app.routers.smartboard._get_gemini_key", return_value="fake_key"):
        with patch("httpx.AsyncClient.post") as mock_post:
            mock_post.return_value = MagicMock(
                status_code=200,
                json=lambda: {"candidates": [{"content": {"parts": [{"text": '{"elements": [{"type": "circle", "x": 10, "y": 10, "radius": 5}]}'}]}}]}
            )
            r = client.post("/api/v1/smartboard/generate-vector", json={"prompt": "circle"})
            assert r.status_code == 200
            data = r.json()
            assert "elements" in data
            assert len(data["elements"]) == 1
            assert data["elements"][0]["type"] == "circle"


def test_smartboard_generate_simulation_mocked():
    db = MagicMock()
    app = create_app(db=db, storage=MagicMock(), token_verifier=MagicMock(), ai_adapter=MagicMock(), rag=MagicMock(), run_worker=False)
    client = TestClient(app)
    with patch("backend.app.routers.smartboard._get_gemini_key", return_value="fake_key"):
        with patch("httpx.AsyncClient.post") as mock_post:
            mock_post.return_value = MagicMock(
                status_code=200,
                json=lambda: {"candidates": [{"content": {"parts": [{"text": "```html<div>simulation</div>```"}]}}]}
            )
            r = client.post("/api/v1/smartboard/generate-simulation", json={"prompt": "simulation"})
            assert r.status_code == 200
            assert r.json()["code"] == "<div>simulation</div>"


def test_smartboard_chat_mocked():
    db = MagicMock()
    app = create_app(db=db, storage=MagicMock(), token_verifier=MagicMock(), ai_adapter=MagicMock(), rag=MagicMock(), run_worker=False)
    client = TestClient(app)
    with patch("backend.app.routers.smartboard._get_gemini_key", return_value="fake_key"):
        with patch("httpx.AsyncClient.post") as mock_post:
            mock_post.return_value = MagicMock(
                status_code=200,
                json=lambda: {
                    "candidates": [
                        {
                            "content": {
                                "parts": [
                                    {"text": "I drew a rectangle."},
                                    {"functionCall": {"name": "draw_rectangle", "args": {"x": 10, "y": 20, "width": 100, "height": 50, "color": "#000"}}}
                                ]
                            }
                        }
                    ]
                }
            )
            r = client.post("/api/v1/smartboard/chat", json={"messages": [{"role": "user", "text": "draw a rect"}]})
            assert r.status_code == 200
            res = r.json()
            assert res["text"] == "I drew a rectangle."
            assert len(res["functionCalls"]) == 1
            assert res["functionCalls"][0]["functionCall"]["name"] == "draw_rectangle"


def test_smartboard_chat_with_audio_payload():
    db = MagicMock()
    app = create_app(db=db, storage=MagicMock(), token_verifier=MagicMock(), ai_adapter=MagicMock(), rag=MagicMock(), run_worker=False)
    client = TestClient(app)
    with patch("backend.app.routers.smartboard._get_gemini_key", return_value="fake_key"):
        with patch("httpx.AsyncClient.post") as mock_post:
            mock_post.return_value = MagicMock(
                status_code=200,
                json=lambda: {
                    "candidates": [
                        {
                            "content": {
                                "parts": [
                                    {"text": "I heard your voice note and answered your question."}
                                ]
                            }
                        }
                    ]
                }
            )
            r = client.post("/api/v1/smartboard/chat", json={
                "messages": [{
                    "role": "user",
                    "text": "Voice Note",
                    "audio": "UklGRi4AAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=",
                    "mime_type": "audio/wav"
                }]
            })
            assert r.status_code == 200
            res = r.json()
            assert res["text"] == "I heard your voice note and answered your question."
            # Verify call payload had inlineData
            called_payload = mock_post.call_args[1]["json"]
            user_parts = called_payload["contents"][0]["parts"]
            assert any("inlineData" in p and p["inlineData"]["mimeType"] == "audio/wav" for p in user_parts)


def test_smartboard_chat_malformed_audio_returns_400():
    db = MagicMock()
    app = create_app(db=db, storage=MagicMock(), token_verifier=MagicMock(), ai_adapter=MagicMock(), rag=MagicMock(), run_worker=False)
    client = TestClient(app)
    with patch("backend.app.routers.smartboard._get_gemini_key", return_value="fake_key"):
        r = client.post("/api/v1/smartboard/chat", json={
            "messages": [{
                "role": "user",
                "text": "Voice Note",
                "audio": "this_is_not_valid_base64!@#$%",
                "mime_type": "audio/wav"
            }]
        })
        assert r.status_code == 400
        assert "Invalid audio base64 payload" in r.json()["detail"]


def test_smartboard_chat_oversized_audio_returns_413():
    db = MagicMock()
    app = create_app(db=db, storage=MagicMock(), token_verifier=MagicMock(), ai_adapter=MagicMock(), rag=MagicMock(), run_worker=False)
    client = TestClient(app)
    with patch("backend.app.routers.smartboard._get_gemini_key", return_value="fake_key"):
        oversized = "A" * (11 * 1024 * 1024)
        r = client.post("/api/v1/smartboard/chat", json={
            "messages": [{
                "role": "user",
                "text": "Big Audio",
                "audio": oversized,
                "mime_type": "audio/wav"
            }]
        })
        assert r.status_code == 413
        assert "Audio payload too large" in r.json()["detail"]


def test_smartboard_chat_timeout_returns_504():
    import httpx
    db = MagicMock()
    app = create_app(db=db, storage=MagicMock(), token_verifier=MagicMock(), ai_adapter=MagicMock(), rag=MagicMock(), run_worker=False)
    client = TestClient(app)
    with patch("backend.app.routers.smartboard._get_gemini_key", return_value="fake_key"):
        with patch("httpx.AsyncClient.post", side_effect=httpx.TimeoutException("timeout")):
            r = client.post("/api/v1/smartboard/chat", json={
                "messages": [{"role": "user", "text": "slow query"}]
            })
            assert r.status_code == 504
            assert "timed out" in r.json()["detail"]


def test_save_whiteboard_oversized_payload_returns_413():
    from backend.app.auth import CurrentUser, get_current_user
    db = MagicMock()
    app = create_app(db=db, storage=MagicMock(), token_verifier=MagicMock(), ai_adapter=MagicMock(), rag=MagicMock(), run_worker=False)
    student = CurrentUser(
        user_id="s1",
        auth_user_id="auth_s1",
        university_id="u1",
        role="STUDENT",
        email="student@test.com",
        first_name="Jane",
        last_name="Doe",
    )
    app.dependency_overrides[get_current_user] = lambda: student
    client = TestClient(app)

    # Create payload totalling > 380,000 bytes within allowed element limits
    body = {
        "steps": [],
        "strokes": [],
        "elements": [
            {
                "id": "img1",
                "kind": "image",
                "author": "student",
                "src": "data:image/png;base64," + ("A" * 385000),
            }
        ],
    }
    with patch("backend.app.routers.student._open_attempt_for", return_value={"attempt_id": "att1", "whiteboard": None}):
        r = client.put(
            "/api/v1/student/assignments/A1/whiteboard",
            json=body,
            headers={"Authorization": "Bearer fake_token"}
        )
        assert r.status_code == 413
        assert r.json()["error"]["code"] == "board_too_large"

