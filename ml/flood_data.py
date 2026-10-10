"""Strict input contract for issue-time flood forecasting. Never invent labels."""
import numpy as np
import pandas as pd

FEATURES=['rain_1h_mm','rain_3h_mm','rain_24h_mm','forecast_rain_mm','elevation_m','impervious_fraction','distance_drain_m']
TIMES=['issued_at','target_at','features_available_at','forecast_issued_at']
REQUIRED=['event_id','site_id',*TIMES,'horizon_hours','latitude','longitude',*FEATURES,'flood_depth_cm','flooded','verification_status','observation_source','feature_source','boundary_verified']

def validate_observations(df, depth_threshold_cm=10):
    df=df.copy()
    missing=sorted(set(REQUIRED)-set(df))
    if missing:raise ValueError('Missing columns: '+', '.join(missing))
    if len(df)==0:raise ValueError('No observations. Template is intentionally empty.')
    if not np.isfinite(depth_threshold_cm) or depth_threshold_cm<=0:raise ValueError('Invalid depth threshold')
    if df[REQUIRED].isna().any().any():raise ValueError('Missing values; do not turn missing observations into non-flood labels.')
    for col in ['event_id','site_id','observation_source','feature_source','verification_status']:
        df[col]=df[col].astype(str).str.strip()
        if df[col].eq('').any():raise ValueError('Empty provenance/identifier: '+col)
    for col in TIMES:
        # Require explicit UTC offset. pd.to_datetime(..., utc=True) alone would silently accept naive time.
        if not df[col].astype(str).str.contains(r'(Z|[+-]\d{2}:\d{2})$',regex=True).all():raise ValueError('Explicit timezone required: '+col)
        df[col]=pd.to_datetime(df[col],utc=True,errors='raise')
    numeric=FEATURES+['horizon_hours','latitude','longitude','flood_depth_cm','flooded']
    for col in numeric:df[col]=pd.to_numeric(df[col],errors='raise')
    if not np.isfinite(df[numeric].to_numpy()).all():raise ValueError('Non-finite numeric value')
    if not df.horizon_hours.isin([1,2,3]).all() or df.horizon_hours.nunique()!=1:raise ValueError('Train one fixed horizon of 1, 2 or 3 hours at a time')
    if not ((df.target_at-df.issued_at)==pd.to_timedelta(df.horizon_hours,unit='h')).all():raise ValueError('Target time does not match forecast horizon')
    if (df.features_available_at>df.issued_at).any() or (df.forecast_issued_at>df.issued_at).any():raise ValueError('Future feature leakage')
    if (df.forecast_issued_at<df.issued_at-pd.Timedelta(hours=24)).any():raise ValueError('Archived forecast older than 24 hours; investigate before training')
    if df.duplicated(['site_id','issued_at','horizon_hours']).any():raise ValueError('Duplicate site/issue/horizon rows')
    if not df.verification_status.eq('verified').all():raise ValueError('Labels must be verified')
    if not df.boundary_verified.astype(str).str.lower().isin(['true','1']).all():raise ValueError('Sites must be verified against official study boundary')
    if not df.latitude.between(-90,90).all() or not df.longitude.between(-180,180).all():raise ValueError('Invalid coordinates')
    if not df.impervious_fraction.between(0,1).all():raise ValueError('Impervious fraction must be 0..1')
    if (df[['rain_1h_mm','rain_3h_mm','rain_24h_mm','forecast_rain_mm','distance_drain_m','flood_depth_cm']]<0).any().any():raise ValueError('Negative rain, distance or flood depth')
    if (df.rain_1h_mm>df.rain_3h_mm).any() or (df.rain_3h_mm>df.rain_24h_mm).any():raise ValueError('Inconsistent accumulated rainfall windows')
    if not df.flooded.isin([0,1]).all():raise ValueError('Labels must be 0 or 1')
    if not df.flooded.eq((df.flood_depth_cm>=depth_threshold_cm).astype(int)).all():raise ValueError('Label inconsistent with documented depth threshold')
    if df.groupby('site_id')[['latitude','longitude']].nunique().gt(1).any().any():raise ValueError('One site ID has inconsistent coordinates')
    return df.sort_values('issued_at')

def split_events(df):
    events=df.groupby('event_id').issued_at.min().sort_values().index.tolist()
    if len(events)<10:raise ValueError('At least 10 independent events required by software; scientific sufficiency needs a separate assessment.')
    a=int(len(events)*.6);b=int(len(events)*.8)
    parts=[df[df.event_id.isin(ids)] for ids in (events[:a],events[a:b],events[b:])]
    for previous,following in zip(parts,parts[1:]):
        # Purge a full 24-hour feature window in addition to non-overlapping labels.
        if previous.target_at.max()>=following.issued_at.min()-pd.Timedelta(hours=24):raise ValueError('Event split overlaps target/feature windows; need 24h embargo')
    for part in parts:
        counts=part.flooded.value_counts()
        if min(counts.get(0,0),counts.get(1,0))<5:raise ValueError('Each partition needs at least 5 verified samples per class; collect more events')
    return parts
