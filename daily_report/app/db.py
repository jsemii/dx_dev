from collections.abc import Iterator
from contextlib import contextmanager

import psycopg
from psycopg import Connection
from psycopg.rows import dict_row

from app.config import Settings, get_settings


@contextmanager
def database_connection(
    settings: Settings | None = None,
) -> Iterator[Connection]:
    active_settings = settings or get_settings()
    connection = psycopg.connect(
        **active_settings.database_connect_kwargs(),
        row_factory=dict_row,
    )
    try:
        yield connection
    finally:
        connection.close()
