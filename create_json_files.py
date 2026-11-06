import json
import math
from pathlib import Path

import pandas as pd

CONTENT_DIR = Path("content")

# Столбцы связей игры с первоисточником (games.csv)
RELATION_TITLE_COLUMN = "Связанные игры (первоисточник)"
RELATION_LINK_COLUMN = "Связанные игры (ссылка)"
RELATION_PLATFORM_COLUMN = "Связанные игры (Платформа)"

# Тип связи вычисляется по значению столбца "Связанные игры (ссылка)":
#   "каталог"        — значение является числовым ID игры из games.csv;
#   "внешняя ссылка" — значение начинается с http:// или https://;
#   "не определён"   — значение пустое или не похоже ни на то, ни на другое.
RELATION_TYPE_CATALOG = "каталог"
RELATION_TYPE_EXTERNAL = "внешняя ссылка"
RELATION_TYPE_UNKNOWN = "не определён"

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

# Справочники только каталога игр
UNIQUE_FIELDS_ONLY_GAMES = [
    ("Происхождение", "origins"),
    ("Достоверность происхождения", "reliability"),
    ("Характер переработки", "rework"),
    (RELATION_TITLE_COLUMN, "source-titles"),
    (RELATION_PLATFORM_COLUMN, "source-platforms"),
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


"""Возвращает строковое значение столбца без pandas-артефактов (NaN, 1984.0)."""
def as_text(value):

    if value is None or pd.isna(value):
        return ""

    if isinstance(value, float):
        if math.isnan(value):
            return ""

        if value.is_integer():
            return str(int(value))

    return str(value).strip()


# Столбцы, где значения перечисляются через запятую: они дробятся при сборе справочников
# Остальные сохраняются целиком (запятая внутри названия не разделяет его на два значения)
SPLIT_FIELDS = {
    "Авторы",
    "Издатель",
    "Жанр",
    "Язык интерфейса",
    "Характер переработки",
}


"""Возвращает список значений столбца для справочника."""
def dictionary_values(field, value):

    if field in SPLIT_FIELDS:
        return split_multi_value(value)

    text = as_text(value)

    return [text] if text else []


"""
Собирает описание связи из трёх столбцов записи.

Возвращает None, если связь не заполнена: пустые столбцы связей — вариант нормы, поля необязательные.
"""
def relation_from_values(title, link, platform):

    title = as_text(title)
    link = as_text(link)
    platform = as_text(platform)

    if not title and not link and not platform:
        return None

    if link.startswith("http://") or link.startswith("https://"):
        relation_type = RELATION_TYPE_EXTERNAL
        target_id = None
    elif link.isdigit():
        relation_type = RELATION_TYPE_CATALOG
        target_id = int(link)
    else:
        relation_type = RELATION_TYPE_UNKNOWN
        target_id = None

    return {
        RELATION_TITLE_COLUMN: title or None,
        RELATION_LINK_COLUMN: link or None,
        RELATION_PLATFORM_COLUMN: platform or None,
        "Тип связи": relation_type if link else None,
        "ID цели": target_id,
        "Название цели": None,
    }


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

    unique_fields = list(UNIQUE_FIELDS)

    if dataset_name == "games":
        unique_fields += UNIQUE_FIELDS_ONLY_GAMES

    unique_data = {
        field_name: set()
        for field_name, _ in unique_fields
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

        # Для каталога игр добавляем разбор связи (структура существующих
        # полей не меняется: добавляется только новый ключ "Связь с первоисточником").
        if dataset_name == "games":
            relation = relation_from_values(
                record.get(RELATION_TITLE_COLUMN),
                record.get(RELATION_LINK_COLUMN),
                record.get(RELATION_PLATFORM_COLUMN),
            )

            record["Связь с первоисточником"] = relation
            record["Есть связь"] = relation is not None

        # Собираем уникальные значения
        for field in unique_data:

            if field in row:
                for item in dictionary_values(field, normalize_value(row[field])):
                    unique_data[field].add(item)

        records.append(record)

    # Для внутренних связей проставляем название игры-цели из того же каталога.
    if dataset_name == "games":
        titles_by_id = {}

        for record in records:
            game_id = record.get("ID")

            if game_id is not None:
                key = str(game_id).strip()

                if key and key not in titles_by_id:
                    titles_by_id[key] = record.get("Название")

        for record in records:
            relation = record.get("Связь с первоисточником")

            if not relation or relation.get("ID цели") is None:
                continue

            target_title = titles_by_id.get(str(relation["ID цели"]))

            relation["Название цели"] = target_title

            if target_title is None:
                relation["Цель в каталоге не найдена"] = True

    # Основной JSON
    save_json(
        f"{dataset_name}.json",
        records
    )

    # JSON со справочниками (пропущенные в CSV столбцы не генерируются)
    for field_name, output_prefix in unique_fields:

        if field_name not in unique_data:
            continue

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
