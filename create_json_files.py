import json
import math
from pathlib import Path

import pandas as pd

CONTENT_DIR = Path("content")

FILE_PREFIX = {
    "games": "https://kalininskiy.github.io/bk-catalog/bk_games_files/",
    "software": "https://kalininskiy.github.io/bk-catalog/bk_files/",
    "demoscene": "https://kalininskiy.github.io/bk-catalog/bk_files/",
}

SCREENSHOT_PREFIX = {
    "games": "https://kalininskiy.github.io/bk-catalog/bk_games_screenshots/",
    "software": "https://kalininskiy.github.io/bk-catalog/bk_screenshots/",
    "demoscene": "https://kalininskiy.github.io/bk-catalog/bk_screenshots/",
}

CSV_FILES = {
    "games": "games.csv",
    "software": "software.csv",
    "demoscene": "demoscene.csv",
}

UNIQUE_FIELDS = [
    ("Авторы", "authors"),
    ("Платформа", "platforms"),
    ("Жанр", "genres"),
    ("Издатель", "publishers"),
]

FILE_COLUMNS = [
    "Имя файла 1",
    "Имя файла 2",
    "Имя файла 3",
    "Имя файла 4",
    "Имя файла 5",
]

SCREENSHOT_COLUMNS = [
    f"Скриншот {i}" for i in range(1, 13)
]


def normalize_value(v):
    if pd.isna(v):
        return None

    if isinstance(v, float):
        if math.isnan(v):
            return None

        # 2026.0 -> 2026
        if v.is_integer():
            return int(v)

    return v


def add_prefix(value, prefix):
    if value is None:
        return None

    value = str(value).strip()

    if not value:
        return None

    if value.startswith("http://") or value.startswith("https://"):
        return value

    return prefix + value


def split_multi_value(value):
    if value is None:
        return []

    parts = []

    for item in str(value).split(","):
        item = item.strip()
        if item:
            parts.append(item)

    return parts


def save_json(filename, data):
    path = CONTENT_DIR / filename

    with open(path, "w", encoding="utf-8") as f:
        json.dump(
            data,
            f,
            ensure_ascii=False,
            indent=2,
        )

    print(f"Written: {path}")


for dataset_name, csv_name in CSV_FILES.items():

    csv_path = CONTENT_DIR / csv_name

    df = pd.read_csv(csv_path)

    records = []

    unique_data = {
        "Авторы": set(),
        "Платформа": set(),
        "Жанр": set(),
        "Издатель": set(),
    }

    for _, row in df.iterrows():

        record = {}

        for column in df.columns:

            value = normalize_value(row[column])

            # Добавление URL к файлам
            if column in FILE_COLUMNS:
                value = add_prefix(
                    value,
                    FILE_PREFIX[dataset_name]
                )

            # Добавление URL к скриншотам
            elif column in SCREENSHOT_COLUMNS:
                value = add_prefix(
                    value,
                    SCREENSHOT_PREFIX[dataset_name]
                )

            record[column] = value

        # Собираем уникальные значения
        for field in unique_data:

            if field in row:
                value = normalize_value(row[field])

                for item in split_multi_value(value):
                    unique_data[field].add(item)

        records.append(record)

    # Основной JSON
    save_json(
        f"{dataset_name}.json",
        records
    )

    # JSON со справочниками
    for field_name, output_prefix in UNIQUE_FIELDS:

        values = sorted(unique_data[field_name])

        save_json(
            f"{output_prefix}-{dataset_name}.json",
            values
        )


# Дополнительные поля только из demoscene.csv
demoscene = pd.read_csv(
    CONTENT_DIR / "demoscene.csv"
)

parties = set()
compos = set()

for _, row in demoscene.iterrows():

    for item in split_multi_value(
        normalize_value(row.get("Демопати"))
    ):
        parties.add(item)

    for item in split_multi_value(
        normalize_value(row.get("Компо"))
    ):
        compos.add(item)

save_json(
    "parties.json",
    sorted(parties)
)

save_json(
    "compos.json",
    sorted(compos)
)
