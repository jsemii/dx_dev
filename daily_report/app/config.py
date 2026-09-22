from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


ReportProfile = Literal["one_person", "two_to_three"]


class Settings(BaseSettings):
    pg_host: str = Field(default="", alias="PGHOST")
    pg_port: int = Field(default=3310, alias="PGPORT")
    pg_database: str = Field(default="", alias="PGDATABASE")
    pg_user: str = Field(default="", alias="PGUSER")
    pg_password: SecretStr | None = Field(default=None, alias="PGPASSWORD")
    pg_sslmode: str = Field(default="require", alias="PGSSLMODE")
    pg_connect_timeout: int = Field(default=10, alias="PGCONNECT_TIMEOUT")

    openai_api_key: SecretStr | None = None
    openai_model: str = "gpt-5-mini"
    openai_store: bool = False

    active_report_profile: ReportProfile = "one_person"
    report_output_dir: Path = Path("data/output")

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        populate_by_name=True,
    )

    def require_openai_api_key(self) -> str:
        if self.openai_api_key is None or not self.openai_api_key.get_secret_value():
            raise RuntimeError("OPENAI_API_KEY가 설정되지 않았습니다.")
        return self.openai_api_key.get_secret_value()

    def require_pg_password(self) -> str:
        if self.pg_password is None or not self.pg_password.get_secret_value():
            raise RuntimeError("PGPASSWORD가 설정되지 않았습니다.")
        return self.pg_password.get_secret_value()

    def database_connect_kwargs(self) -> dict[str, str | int]:
        missing = [
            name
            for name, value in (
                ("PGHOST", self.pg_host),
                ("PGDATABASE", self.pg_database),
                ("PGUSER", self.pg_user),
            )
            if not value
        ]
        if missing:
            raise RuntimeError(f"DB 환경변수가 설정되지 않았습니다: {', '.join(missing)}")
        return {
            "host": self.pg_host,
            "port": self.pg_port,
            "dbname": self.pg_database,
            "user": self.pg_user,
            "password": self.require_pg_password(),
            "sslmode": self.pg_sslmode,
            "connect_timeout": self.pg_connect_timeout,
        }


@lru_cache
def get_settings() -> Settings:
    return Settings()
