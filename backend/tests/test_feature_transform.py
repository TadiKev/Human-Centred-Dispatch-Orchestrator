import pandas as pd
import numpy as np
import pytest

from backend.ml_service import main as ml_main


def test_scalarize_list_cells():
    df = pd.DataFrame({'a': [[1,2], [], ['x','y']], 'b': [1,2,3]})
    out = ml_main.scalarize_list_cells(df.copy())
    assert out.loc[0, 'a'] == '1,2'
    assert out.loc[1, 'a'] == '' or out.loc[1, 'a'] == ''
    assert out.loc[2, 'a'] == 'x,y'


def test_add_missing_and_reindex():
    df = pd.DataFrame({'num_required_skills': [1], 'distance_km':[5.2]})
    required = ['customer_name', 'num_required_skills', 'distance_km']
    out = ml_main.add_missing_and_reindex(df.copy(), required)
    assert list(out.columns) == required
    # missing column should be present and NaN
    assert pd.isna(out.loc[0, 'customer_name'])


def test_prepare_input_df_basic():
    payload = {
        'assigned_technician_id': 42,
        'distance_km': 5.2,
        'time_of_day': 'morning',
        'weekday': 'Tuesday'
    }
    df = ml_main.prepare_input_df(payload)
    assert 'time_of_day' in df.columns
    assert df.loc[0, 'assigned_technician_id'] == 42
    assert isinstance(df.loc[0, 'time_of_day'], str)


def test_coerce_numeric_cols():
    df = pd.DataFrame({'a': ['1', '2', ''], 'b': ['x', 'y', 'z']})
    out = ml_main.coerce_numeric_cols(df.copy())
    assert pd.api.types.is_numeric_dtype(out['a'])
    assert not pd.api.types.is_numeric_dtype(out['b'])
